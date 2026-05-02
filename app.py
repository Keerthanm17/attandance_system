"""
College Attendance Management System - Flask Backend
MVJ College of Engineering
"""

import json
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import firebase_admin
from firebase_admin import auth, credentials, firestore
from flask import Flask, jsonify, request
from flask_cors import CORS
from dotenv import load_dotenv

load_dotenv()


def parse_allowed_origins():
    """Builds the allowed CORS origins list from env."""
    raw_origins = os.getenv(
        "ALLOWED_ORIGINS",
        "http://127.0.0.1:5500,http://localhost:5500,http://127.0.0.1:3000,http://localhost:3000",
    )
    return [origin.strip() for origin in raw_origins.split(",") if origin.strip()]


def load_firebase_credential():
    """Loads Firebase Admin credentials from env JSON or a file path."""
    service_account_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    service_account_path = os.getenv("FIREBASE_SERVICE_ACCOUNT_PATH")
    project_dir = os.path.dirname(os.path.abspath(__file__))
    fallback_paths = [
        os.path.join(project_dir, "serviceAcountkey.json"),
        os.path.join(project_dir, "serviceAccountKey.json"),
    ]

    if service_account_json:
        return credentials.Certificate(json.loads(service_account_json))

    candidate_paths = [service_account_path] if service_account_path else []
    candidate_paths.extend(fallback_paths)

    for path in candidate_paths:
        if path and os.path.exists(path):
            return credentials.Certificate(path)

    raise RuntimeError(
        "Firebase credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_JSON or "
        "FIREBASE_SERVICE_ACCOUNT_PATH, or place serviceAcountkey.json next to app.py."
    )

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": parse_allowed_origins()}})

APP_TIMEZONE = ZoneInfo("Asia/Kolkata")

cred = load_firebase_credential()
firebase_admin.initialize_app(cred)
db = firestore.client()


def normalize_role(role):
    """Normalizes role values so Admin/admin are treated the same."""
    return str(role or "").strip().lower()


VALID_ROLES = {"admin", "hod", "teaching", "lab_instructor", "student"}


def now_iso():
    """Returns the current timestamp as an ISO string in the app timezone."""
    return datetime.now(APP_TIMEZONE).isoformat()


def today_str():
    """Returns today's date as YYYY-MM-DD string in the app timezone."""
    return datetime.now(APP_TIMEZONE).strftime("%Y-%m-%d")


def get_verified_uid(req):
    """
    Extracts the Bearer token from the Authorization header,
    verifies it with Firebase Auth, and returns the uid.
    """
    auth_header = req.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return None

    id_token = auth_header.split("Bearer ")[1]
    try:
        decoded = auth.verify_id_token(id_token)
        return decoded["uid"]
    except Exception:
        return None


def get_user_profile(uid):
    """Fetches a user profile from the Users collection."""
    doc = db.collection("Users").document(uid).get()
    if not doc.exists:
        return None

    data = doc.to_dict()
    data["role"] = normalize_role(data.get("role", "unknown"))
    return data


def get_user_role(uid):
    """Returns the normalized role of the given user."""
    profile = get_user_profile(uid)
    if not profile:
        return None
    return profile.get("role")


def get_session_state(uid):
    """
    Returns the active attendance session, the latest session,
    and all sessions for the given user.
    """
    records = []
    query = db.collection("Attendance").where("uid", "==", uid)

    for doc in query.stream():
        record = doc.to_dict()
        record["id"] = doc.id
        record["role"] = normalize_role(record.get("role", "unknown"))
        records.append(record)

    records.sort(key=lambda record: record.get("entry_time") or "", reverse=True)
    active_session = next((record for record in records if not record.get("exit_time")), None)
    latest_session = records[0] if records else None
    return active_session, latest_session, records


def require_admin(req):
    """Verifies the caller and returns an error response unless they are admin."""
    uid = get_verified_uid(req)
    if not uid:
        return None, (jsonify({"error": "Unauthorized"}), 401)

    if get_user_role(uid) != "admin":
        return None, (jsonify({"error": "Forbidden: Admin access required"}), 403)

    return uid, None


@app.route("/api/login", methods=["POST"])
def login():
    """
    Authentication has already happened in Firebase on the frontend.
    This route only returns the user profile and current attendance state.
    """
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized: invalid or missing token"}), 401

    user_data = get_user_profile(uid)
    if not user_data:
        return jsonify({"error": "User profile not found in system"}), 404

    active_session, latest_session, _ = get_session_state(uid)

    return jsonify({
        "message": "Authenticated",
        "name": user_data.get("name"),
        "role": user_data.get("role"),
        "uid": uid,
        "active_session": active_session,
        "latest_session": latest_session,
    }), 200


@app.route("/api/health", methods=["GET"])
def health_check():
    """Simple health endpoint for hosting platforms and uptime checks."""
    return jsonify({
        "status": "ok",
        "generated_at": now_iso(),
    }), 200


@app.route("/api/account_requests", methods=["POST"])
def submit_account_request():
    """
    Creates a disabled Firebase Auth account and stores a pending admin request.
    Body JSON: { "email": "...", "password": "...", "name": "...", "role": "..." }
    """
    data = request.get_json() or {}
    email = str(data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    name = str(data.get("name") or "").strip()
    role = normalize_role(data.get("role") or "teaching")

    allowed_request_roles = {"hod", "teaching", "lab_instructor", "student"}
    if not all([email, password, name, role]) or role not in allowed_request_roles:
        return jsonify({"error": f"Missing fields or invalid role. Valid roles: {allowed_request_roles}"}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400

    existing_requests = (
        db.collection("AccountRequests")
        .where("email", "==", email)
        .where("status", "==", "pending")
        .limit(1)
        .stream()
    )
    if any(existing_requests):
        return jsonify({"error": "A pending request already exists for this email."}), 409

    try:
        new_user = auth.create_user(
            email=email,
            password=password,
            display_name=name,
            disabled=True,
        )
        request_record = {
            "uid": new_user.uid,
            "name": name,
            "email": email,
            "role": role,
            "status": "pending",
            "requested_at": now_iso(),
            "reviewed_at": None,
            "reviewed_by": None,
        }
        db.collection("AccountRequests").document(new_user.uid).set(request_record)
        return jsonify({
            "message": "Account request submitted. An admin must approve it before login.",
            "request_id": new_user.uid,
        }), 201
    except auth.EmailAlreadyExistsError:
        return jsonify({"error": "An account already exists for this email."}), 409
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/account_requests", methods=["GET"])
def list_account_requests():
    """Returns account creation requests for the admin dashboard."""
    _, error_response = require_admin(request)
    if error_response:
        return error_response

    status_filter = normalize_role(request.args.get("status") or "")
    requests_query = db.collection("AccountRequests")
    if status_filter:
        requests_query = requests_query.where("status", "==", status_filter)

    requests_list = []
    for doc in requests_query.stream():
        item = doc.to_dict()
        item["id"] = doc.id
        item["role"] = normalize_role(item.get("role", "unknown"))
        requests_list.append(item)

    requests_list.sort(key=lambda item: item.get("requested_at") or "", reverse=True)
    return jsonify({
        "requests": requests_list,
        "generated_at": now_iso(),
    }), 200


@app.route("/api/account_requests/<request_id>/accept", methods=["POST"])
def accept_account_request(request_id):
    """Approves a pending account request and enables the Firebase Auth user."""
    admin_uid, error_response = require_admin(request)
    if error_response:
        return error_response

    request_ref = db.collection("AccountRequests").document(request_id)
    request_doc = request_ref.get()
    if not request_doc.exists:
        return jsonify({"error": "Account request not found."}), 404

    account_request = request_doc.to_dict() or {}
    if account_request.get("status") != "pending":
        return jsonify({"error": "Only pending requests can be accepted."}), 400

    target_uid = account_request.get("uid") or request_id
    role = normalize_role(account_request.get("role"))
    if role not in VALID_ROLES:
        return jsonify({"error": "Requested role is invalid."}), 400

    try:
        auth.update_user(target_uid, disabled=False)
    except auth.UserNotFoundError:
        return jsonify({"error": "Requested Firebase account no longer exists."}), 404
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    db.collection("Users").document(target_uid).set({
        "uid": target_uid,
        "name": account_request.get("name"),
        "role": role,
        "email": account_request.get("email"),
        "account_status": "active",
        "created_at": now_iso(),
    })
    request_ref.update({
        "status": "accepted",
        "reviewed_at": now_iso(),
        "reviewed_by": admin_uid,
    })

    return jsonify({
        "message": f"Request accepted. {account_request.get('name') or account_request.get('email')} can now log in.",
        "uid": target_uid,
    }), 200


@app.route("/api/account_requests/<request_id>/reject", methods=["POST"])
def reject_account_request(request_id):
    """Rejects a pending account request and removes its disabled Firebase Auth user."""
    admin_uid, error_response = require_admin(request)
    if error_response:
        return error_response

    request_ref = db.collection("AccountRequests").document(request_id)
    request_doc = request_ref.get()
    if not request_doc.exists:
        return jsonify({"error": "Account request not found."}), 404

    account_request = request_doc.to_dict() or {}
    if account_request.get("status") != "pending":
        return jsonify({"error": "Only pending requests can be rejected."}), 400

    target_uid = account_request.get("uid") or request_id
    try:
        auth.delete_user(target_uid)
    except auth.UserNotFoundError:
        pass
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    request_ref.update({
        "status": "rejected",
        "reviewed_at": now_iso(),
        "reviewed_by": admin_uid,
    })

    return jsonify({
        "message": f"Request rejected for {account_request.get('name') or account_request.get('email')}.",
        "uid": target_uid,
    }), 200


@app.route("/api/clock_in", methods=["POST"])
def clock_in():
    """Starts a new attendance session for the authenticated user."""
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    user_data = get_user_profile(uid)
    if not user_data:
        return jsonify({"error": "User profile not found in system"}), 404

    active_session, _, _ = get_session_state(uid)
    if active_session:
        return jsonify({"error": "You already have an active attendance session."}), 409

    entry_time = now_iso()
    attendance_id = f"{uid}_{datetime.now(APP_TIMEZONE).strftime('%Y%m%dT%H%M%S%f')}"
    attendance_record = {
        "uid": uid,
        "name": user_data.get("name", "Unknown"),
        "role": user_data.get("role", "unknown"),
        "date": today_str(),
        "entry_time": entry_time,
        "exit_time": None,
    }

    db.collection("Attendance").document(attendance_id).set(attendance_record)

    attendance_record["id"] = attendance_id
    return jsonify({
        "message": "Attendance sign-in recorded.",
        "record": attendance_record,
    }), 200


@app.route("/api/clock_out", methods=["POST"])
def clock_out():
    """Closes the currently active attendance session for the authenticated user."""
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    active_session, _, _ = get_session_state(uid)
    if not active_session:
        return jsonify({"error": "No active attendance session found."}), 404

    exit_time = now_iso()
    db.collection("Attendance").document(active_session["id"]).update({"exit_time": exit_time})

    active_session["exit_time"] = exit_time
    return jsonify({
        "message": "Attendance sign-out recorded.",
        "record": active_session,
    }), 200


@app.route("/api/create_user", methods=["POST"])
def create_user():
    """
    Creates a Firebase Auth user and stores profile in Firestore Users collection.
    Body JSON: { "email": "...", "password": "...", "name": "...", "role": "..." }
    """
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    if get_user_role(uid) != "admin":
        return jsonify({"error": "Forbidden: Admin access required"}), 403

    data = request.get_json() or {}
    email = data.get("email")
    password = data.get("password")
    name = data.get("name")
    role = normalize_role(data.get("role"))

    valid_roles = {"admin", "hod", "teaching", "lab_instructor", "student"}
    if not all([email, password, name, role]) or role not in valid_roles:
        return jsonify({"error": f"Missing fields or invalid role. Valid roles: {valid_roles}"}), 400

    try:
        new_user = auth.create_user(email=email, password=password, display_name=name)
        db.collection("Users").document(new_user.uid).set({
            "uid": new_user.uid,
            "name": name,
            "role": role,
            "email": email,
            "account_status": "active",
            "created_at": now_iso(),
        })
        return jsonify({"message": f"User '{name}' created", "uid": new_user.uid}), 201
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/users", methods=["GET"])
def list_users():
    """Returns all user profiles for the admin dashboard."""
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    if get_user_role(uid) != "admin":
        return jsonify({"error": "Forbidden: Admin access required"}), 403

    users = []
    for doc in db.collection("Users").stream():
        user = doc.to_dict()
        user["uid"] = doc.id
        user["role"] = normalize_role(user.get("role", "unknown"))
        user["account_status"] = "active"

        try:
            auth_user = auth.get_user(doc.id)
            user["account_status"] = "disabled" if auth_user.disabled else "active"
        except auth.UserNotFoundError:
            user["account_status"] = normalize_role(user.get("account_status")) or "disabled"

        users.append(user)

    users.sort(key=lambda user: (str(user.get("name") or "").lower(), str(user.get("email") or "").lower()))
    return jsonify({
        "users": users,
        "generated_at": now_iso(),
    }), 200


@app.route("/api/users/<target_uid>", methods=["PATCH"])
def update_user(target_uid):
    """Updates a user's role or active status. Admin only."""
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    if get_user_role(uid) != "admin":
        return jsonify({"error": "Forbidden: Admin access required"}), 403

    profile_ref = db.collection("Users").document(target_uid)
    profile_doc = profile_ref.get()
    if not profile_doc.exists:
        return jsonify({"error": "User profile not found."}), 404

    data = request.get_json() or {}
    role = data.get("role")
    account_status = str(data.get("account_status") or "").strip().lower()

    updates = {}

    if role is not None:
        role = normalize_role(role)
        valid_roles = {"admin", "hod", "teaching", "lab_instructor", "student"}
        if role not in valid_roles:
            return jsonify({"error": f"Invalid role. Valid roles: {valid_roles}"}), 400
        updates["role"] = role

    if account_status:
        if account_status not in {"active", "disabled"}:
            return jsonify({"error": "Invalid account status. Use 'active' or 'disabled'."}), 400

        if uid == target_uid and account_status == "disabled":
            return jsonify({"error": "You cannot disable your own active admin account."}), 400

        try:
            auth.update_user(target_uid, disabled=(account_status == "disabled"))
        except auth.UserNotFoundError:
            return jsonify({"error": "User account not found in Firebase Auth."}), 404
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

        updates["account_status"] = account_status

    if not updates:
        return jsonify({"error": "No valid fields provided for update."}), 400

    profile_ref.update(updates)
    return jsonify({
        "message": "User updated successfully.",
        "uid": target_uid,
        "updates": updates,
    }), 200


@app.route("/api/users/<target_uid>", methods=["DELETE"])
def delete_user(target_uid):
    """Deletes a user from Firebase Auth and the Users collection. Admin only."""
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    if get_user_role(uid) != "admin":
        return jsonify({"error": "Forbidden: Admin access required"}), 403

    if uid == target_uid:
        return jsonify({"error": "You cannot delete your own active admin account."}), 400

    profile_ref = db.collection("Users").document(target_uid)
    profile_doc = profile_ref.get()
    if not profile_doc.exists:
        return jsonify({"error": "User profile not found."}), 404

    profile = profile_doc.to_dict() or {}

    try:
        auth.delete_user(target_uid)
    except auth.UserNotFoundError:
        pass
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    profile_ref.delete()
    return jsonify({
        "message": f"User '{profile.get('name') or profile.get('email') or target_uid}' deleted.",
        "uid": target_uid,
    }), 200


@app.route("/api/attendance", methods=["GET"])
def get_attendance():
    """Returns all attendance records for a given date. Admin only."""
    uid = get_verified_uid(request)
    if not uid:
        return jsonify({"error": "Unauthorized"}), 401

    if get_user_role(uid) != "admin":
        return jsonify({"error": "Forbidden: Admin access required"}), 403

    date_filter = request.args.get("date", today_str())
    records = []

    for doc in db.collection("Attendance").where("date", "==", date_filter).stream():
        record = doc.to_dict()
        record["id"] = doc.id
        record["role"] = normalize_role(record.get("role", "unknown"))
        records.append(record)

    records.sort(key=lambda record: record.get("entry_time") or "")

    return jsonify({
        "date": date_filter,
        "records": records,
        "generated_at": now_iso(),
    }), 200


if __name__ == "__main__":
    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
    )
