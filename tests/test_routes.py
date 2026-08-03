import pytest
import json
from website import create_app, db

@pytest.fixture
def app():
    app = create_app()
    app.config["TESTING"] = True
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
    app.config["WTF_CSRF_ENABLED"] = False

    with app.app_context():
        db.create_all()
        yield app
        db.drop_all()

@pytest.fixture
def client(app):
    return app.test_client()

def register(client, username="testuser", email="test@test.com", password="password123"):
    return client.post("/api/register", json={
        "username": username,
        "email": email,
        "password": password
    })

def login(client, email="test@test.com", password="password123"):
    return client.post("/api/login", json={
        "email": email,
        "password": password
    })

def get_sample_composition():
    return {
        "timeSignature": [4, 4],
        "numMeasures": 1,
        "mode": "Standard",
        "voices": {
            "upperVoice":  {"pitchRange": ["C4", "C6"], "rhythmRange": [0.25, 1], "scale": ["C", "Major"], "notes": []},
            "middleVoice": {"pitchRange": ["A3", "F5"], "rhythmRange": [0.25, 1], "scale": ["C", "Major"], "notes": []},
            "lowerVoice":  {"pitchRange": ["E2", "C4"], "rhythmRange": [0.25, 1], "scale": ["C", "Major"], "notes": []},
            "voice4":      {"pitchRange": ["D3", "B5"], "rhythmRange": [0.25, 1], "scale": ["C", "Major"], "notes": []},
            "harmonyVoice":{"pitchRange": ["C3", "C5"], "rhythmRange": [0.25, 1], "scale": ["C", "Major"], "notes": []}
        }
    }

###########################################################################################
# Register
###########################################################################################

def test_register_success(client):
    res = register(client)
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["username"] == "testuser"

def test_register_duplicate_email(client):
    register(client)
    res = register(client, username="otheruser")
    assert res.status_code == 400
    assert "Email already registered" in res.get_json()["message"]

def test_register_duplicate_username(client):
    register(client)
    res = register(client, email="other@test.com")
    assert res.status_code == 400
    assert "Username already taken" in res.get_json()["message"]

def test_register_missing_fields(client):
    res = client.post("/api/register", json={"username": "joe"})
    assert res.status_code == 400
    assert res.get_json()["success"] is False

def test_register_short_password(client):
    res = register(client, password="abc")
    assert res.status_code == 400
    assert "6 characters" in res.get_json()["message"]

def test_register_invalid_email(client):
    res = register(client, email="notanemail")
    assert res.status_code == 400
    assert "Invalid email" in res.get_json()["message"]

def test_register_short_username(client):
    res = register(client, username="ab")
    assert res.status_code == 400
    assert "3 and 50" in res.get_json()["message"]

###########################################################################################
# Login
###########################################################################################

def test_login_success(client):
    register(client)
    res = login(client)
    assert res.status_code == 200
    assert res.get_json()["success"] is True

def test_login_wrong_password(client):
    register(client)
    res = login(client, password="wrongpassword")
    assert res.status_code == 401
    assert res.get_json()["success"] is False

def test_login_wrong_email(client):
    register(client)
    res = login(client, email="wrong@test.com")
    assert res.status_code == 401
    assert res.get_json()["success"] is False

def test_login_missing_fields(client):
    res = client.post("/api/login", json={"email": "test@test.com"})
    assert res.status_code == 400
    assert res.get_json()["success"] is False

###########################################################################################
# Auth protection
###########################################################################################

def test_get_compositions_requires_login(client):
    res = client.get("/api/compositions")
    assert res.status_code in [401, 302]

def test_save_composition_requires_login(client):
    res = client.post("/api/compositions", json={
        "title": "Test",
        "is_public": False,
        "data": get_sample_composition()
    })
    assert res.status_code in [401, 302]

###########################################################################################
# Compositions
###########################################################################################

def test_save_and_load_composition(client):
    register(client)
    login(client)

    res = client.post("/api/compositions", json={
        "title": "My Piece",
        "is_public": False,
        "data": get_sample_composition()
    })
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    slug = data["slug"]

    res = client.get(f"/api/compositions/{slug}")
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True
    assert data["title"] == "My Piece"

def test_save_composition_missing_title(client):
    register(client)
    login(client)
    res = client.post("/api/compositions", json={
        "title": "",
        "is_public": False,
        "data": get_sample_composition()
    })
    assert res.status_code == 400
    assert res.get_json()["success"] is False

def test_update_composition(client):
    register(client)
    login(client)

    res = client.post("/api/compositions", json={
        "title": "Original",
        "is_public": False,
        "data": get_sample_composition()
    })
    slug = res.get_json()["slug"]

    res = client.put(f"/api/compositions/{slug}", json={
        "title": "Updated",
        "data": get_sample_composition()
    })
    assert res.status_code == 200
    assert res.get_json()["success"] is True

    res = client.get(f"/api/compositions/{slug}")
    assert res.get_json()["title"] == "Updated"

def test_delete_composition(client):
    register(client)
    login(client)

    res = client.post("/api/compositions", json={
        "title": "To Delete",
        "is_public": False,
        "data": get_sample_composition()
    })
    slug = res.get_json()["slug"]

    res = client.delete(f"/api/compositions/{slug}")
    assert res.status_code == 200
    assert res.get_json()["success"] is True

    res = client.get(f"/api/compositions/{slug}")
    assert res.status_code == 404

def test_private_composition_not_accessible_by_other_user(client):
    register(client, username="user1", email="user1@test.com")
    login(client, email="user1@test.com")
    res = client.post("/api/compositions", json={
        "title": "Private",
        "is_public": False,
        "data": get_sample_composition()
    })
    slug = res.get_json()["slug"]

    client.post("/api/logout")

    register(client, username="user2", email="user2@test.com")
    login(client, email="user2@test.com")

    res = client.get(f"/api/compositions/{slug}")
    assert res.status_code == 403

def test_public_composition_accessible_without_login(client):
    register(client)
    login(client)
    res = client.post("/api/compositions", json={
        "title": "Public",
        "is_public": True,
        "data": get_sample_composition()
    })
    slug = res.get_json()["slug"]
    client.post("/api/logout")

    res = client.get(f"/api/compositions/{slug}")
    assert res.status_code == 200
    assert res.get_json()["success"] is True

def test_list_compositions(client):
    register(client)
    login(client)

    client.post("/api/compositions", json={"title": "Piece 1", "is_public": False, "data": get_sample_composition()})
    client.post("/api/compositions", json={"title": "Piece 2", "is_public": False, "data": get_sample_composition()})

    res = client.get("/api/compositions")
    assert res.status_code == 200
    data = res.get_json()
    assert len(data) == 2

def test_me_endpoint_logged_in(client):
    register(client)
    login(client)
    res = client.get("/api/me")
    assert res.status_code == 200
    data = res.get_json()
    assert data["loggedIn"] is True
    assert data["username"] == "testuser"

def test_me_endpoint_logged_out(client):
    res = client.get("/api/me")
    assert res.status_code == 200
    assert res.get_json()["loggedIn"] is False