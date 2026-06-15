from . import db

from flask_login import UserMixin

class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    email = db.Column(db.String(100), unique=True, nullable=False)
    password = db.Column(db.String(500), nullable=False)
class Composer(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(25), nullable=False, unique=True)
    lifetime = db.Column(db.Integer)
    style = db.Column(db.String(20))
    compositions = db.relationship('Composition', backref='composer', lazy=True)

class Composition(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    composer_id = db.Column(db.Integer, db.ForeignKey('composer.id'), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    year = db.Column(db.String(50)) 
    url = db.Column(db.String(255), unique=True, nullable=False) 

import secrets
from datetime import datetime

class UserComposition(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    slug = db.Column(db.String(16), unique=True, nullable=False, default=lambda: secrets.token_urlsafe(8))
    is_public = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    data = db.Column(db.JSON, nullable=False)

    user = db.relationship('User', backref='compositions')