import json
import sqlite3
import threading
import time
from flask import Flask, request, jsonify
from flask_sock import Sock

app = Flask(__name__)
sock = Sock(app)

import os
DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "jukebox.db")

clients = {}  # ws -> user_name
clients_lock = threading.Lock()


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def get_queue(conn):
    songs = conn.execute("SELECT * FROM songs ORDER BY id").fetchall()
    result = []
    for song in songs:
        row = conn.execute(
            "SELECT COALESCE(SUM(vote), 0) as net FROM votes WHERE song_id = ?",
            (song["id"],)
        ).fetchone()
        result.append({
            "id": song["id"],
            "title": song["title"],
            "artist": song["artist"],
            "added_by": song["added_by"],
            "added_at": song["added_at"],
            "net_votes": row["net"],
        })
    result.sort(key=lambda x: (-x["net_votes"], x["added_at"]))
    return result


def get_playback_state(conn):
    row = conn.execute("SELECT * FROM playback WHERE id = 1").fetchone()
    if row is None:
        return {"current_song_id": None, "is_playing": False, "time_remaining": 30.0, "last_updated": time.time()}
    is_playing = bool(row["is_playing"])
    time_remaining = row["time_remaining"]
    last_updated = row["last_updated"] or time.time()
    if is_playing:
        elapsed = time.time() - last_updated
        time_remaining = max(0.0, time_remaining - elapsed)
    return {
        "current_song_id": row["current_song_id"],
        "is_playing": is_playing,
        "time_remaining": time_remaining,
        "last_updated": last_updated,
    }


def get_full_state():
    conn = get_db()
    try:
        queue = get_queue(conn)
        playback = get_playback_state(conn)
        skip_count = conn.execute("SELECT COUNT(*) as cnt FROM skip_votes").fetchone()["cnt"]
        with clients_lock:
            user_count = len(clients)
        return {
            "queue": queue,
            "playback": playback,
            "skip_votes": skip_count,
            "user_count": user_count,
        }
    finally:
        conn.close()


def broadcast(data):
    message = json.dumps(data)
    with clients_lock:
        dead = []
        for ws in list(clients.keys()):
            try:
                ws.send(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            del clients[ws]


def advance_song():
    conn = get_db()
    try:
        pb = conn.execute("SELECT * FROM playback WHERE id = 1").fetchone()
        if pb["current_song_id"]:
            conn.execute("DELETE FROM songs WHERE id = ?", (pb["current_song_id"],))
            conn.execute("DELETE FROM votes WHERE song_id = ?", (pb["current_song_id"],))
        conn.execute("DELETE FROM skip_votes")
        conn.commit()
        queue = get_queue(conn)
        if queue:
            next_song = queue[0]
            conn.execute(
                "UPDATE playback SET current_song_id = ?, is_playing = 1, time_remaining = 30.0, last_updated = ? WHERE id = 1",
                (next_song["id"], time.time()),
            )
        else:
            conn.execute(
                "UPDATE playback SET current_song_id = NULL, is_playing = 0, time_remaining = 30.0, last_updated = ? WHERE id = 1",
                (time.time(),),
            )
        conn.commit()
    finally:
        conn.close()
    broadcast({"type": "state", "data": get_full_state()})


def playback_loop():
    while True:
        time.sleep(0.5)
        try:
            conn = get_db()
            pb = conn.execute("SELECT * FROM playback WHERE id = 1").fetchone()
            should_advance = False
            if pb and pb["is_playing"] and pb["current_song_id"] and pb["last_updated"]:
                elapsed = time.time() - pb["last_updated"]
                remaining = pb["time_remaining"] - elapsed
                if remaining <= 0:
                    should_advance = True
            conn.close()
            if should_advance:
                advance_song()
        except Exception as e:
            print(f"Playback loop error: {e}")


threading.Thread(target=playback_loop, daemon=True).start()


@sock.route("/ws")
def websocket_handler(ws):
    user_name = request.args.get("user_name", "Anonymous")
    with clients_lock:
        clients[ws] = user_name
    try:
        ws.send(json.dumps({"type": "state", "data": get_full_state()}))
        broadcast({"type": "state", "data": get_full_state()})
        while True:
            try:
                data = ws.receive()
                if data is None:
                    break
            except Exception:
                break
    finally:
        with clients_lock:
            clients.pop(ws, None)
        broadcast({"type": "state", "data": get_full_state()})


@app.route("/api/songs", methods=["POST"])
def add_song():
    data = request.json or {}
    title = data.get("title", "").strip()
    artist = data.get("artist", "").strip()
    added_by = data.get("added_by", "Anonymous")
    if not title or not artist:
        return jsonify({"error": "Title and artist are required"}), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO songs (title, artist, added_by, added_at) VALUES (?, ?, ?, ?)",
            (title, artist, added_by, time.time()),
        )
        conn.commit()
    finally:
        conn.close()
    broadcast({"type": "state", "data": get_full_state()})
    return jsonify({"ok": True})


@app.route("/api/songs/<int:song_id>/vote", methods=["POST"])
def vote(song_id):
    data = request.json or {}
    user_id = data.get("user_id")
    vote_type = data.get("vote")  # 'up' or 'down'
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    vote_value = 1 if vote_type == "up" else -1
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT vote FROM votes WHERE song_id = ? AND user_id = ?",
            (song_id, user_id),
        ).fetchone()
        if existing:
            if existing["vote"] == vote_value:
                conn.execute(
                    "DELETE FROM votes WHERE song_id = ? AND user_id = ?",
                    (song_id, user_id),
                )
            else:
                conn.execute(
                    "UPDATE votes SET vote = ? WHERE song_id = ? AND user_id = ?",
                    (vote_value, song_id, user_id),
                )
        else:
            conn.execute(
                "INSERT INTO votes (song_id, user_id, vote) VALUES (?, ?, ?)",
                (song_id, user_id, vote_value),
            )
        conn.commit()
    finally:
        conn.close()
    broadcast({"type": "state", "data": get_full_state()})
    return jsonify({"ok": True})


@app.route("/api/playback", methods=["POST"])
def toggle_playback():
    conn = get_db()
    try:
        pb = conn.execute("SELECT * FROM playback WHERE id = 1").fetchone()
        is_playing = bool(pb["is_playing"])
        if is_playing:
            elapsed = time.time() - (pb["last_updated"] or time.time())
            remaining = max(0.0, pb["time_remaining"] - elapsed)
            conn.execute(
                "UPDATE playback SET is_playing = 0, time_remaining = ?, last_updated = ? WHERE id = 1",
                (remaining, time.time()),
            )
        else:
            queue = get_queue(conn)
            if pb["current_song_id"] is None and queue:
                conn.execute(
                    "UPDATE playback SET current_song_id = ?, is_playing = 1, time_remaining = 30.0, last_updated = ? WHERE id = 1",
                    (queue[0]["id"], time.time()),
                )
            elif pb["current_song_id"] is not None:
                conn.execute(
                    "UPDATE playback SET is_playing = 1, last_updated = ? WHERE id = 1",
                    (time.time(),),
                )
        conn.commit()
    finally:
        conn.close()
    broadcast({"type": "state", "data": get_full_state()})
    return jsonify({"ok": True})


@app.route("/api/skip", methods=["POST"])
def skip_vote():
    data = request.json or {}
    user_id = data.get("user_id")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT 1 FROM skip_votes WHERE user_id = ?", (user_id,)
        ).fetchone()
        if existing:
            conn.close()
            return jsonify({"ok": True})
        conn.execute("INSERT INTO skip_votes (user_id) VALUES (?)", (user_id,))
        conn.commit()
        skip_count = conn.execute("SELECT COUNT(*) as cnt FROM skip_votes").fetchone()["cnt"]
    finally:
        conn.close()
    with clients_lock:
        user_count = len(clients)
    broadcast({"type": "state", "data": get_full_state()})
    if user_count > 0 and skip_count * 2 > user_count:
        advance_song()
    return jsonify({"ok": True})


@app.route("/api/queue", methods=["DELETE"])
def clear_queue():
    conn = get_db()
    try:
        conn.execute("DELETE FROM votes")
        conn.execute("DELETE FROM songs")
        conn.execute("DELETE FROM skip_votes")
        conn.execute(
            "UPDATE playback SET current_song_id = NULL, is_playing = 0, time_remaining = 30.0, last_updated = ? WHERE id = 1",
            (time.time(),),
        )
        conn.commit()
    finally:
        conn.close()
    broadcast({"type": "state", "data": get_full_state()})
    return jsonify({"ok": True})


@app.route("/api/votes", methods=["GET"])
def get_user_votes():
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({})
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT song_id, vote FROM votes WHERE user_id = ?", (user_id,)
        ).fetchall()
        return jsonify({str(row["song_id"]): row["vote"] for row in rows})
    finally:
        conn.close()


@app.route("/api/state", methods=["GET"])
def get_state():
    return jsonify(get_full_state())


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=3001, debug=False, threaded=True)
