from flask import Blueprint, render_template, request, jsonify, flash, redirect, url_for
from .models import User, Composer, Composition
from . import db  
from flask_login import  current_user

import httpx
from bs4 import BeautifulSoup
import yt_dlp

routes = Blueprint('routes', __name__)

@routes.route('/', methods=['GET', 'POST'])
def home():
    return render_template("index.html", user=current_user)

@routes.route('/scales', methods=['GET', 'POST'])
def scales():
        return render_template('scales.html', user=current_user)

@routes.route('/composer', methods=['GET', 'POST'])
def composer():
        return render_template('composer.html', user=current_user)


###########################################################################################
@routes.route('/index')
def index():
    composers = Composer.query.all()

    # Sort composers by last name (last word in the name string)
    composers = sorted(composers, key=lambda composer: composer.name.split()[-1].lower())

    composers_data = []
    for composer in composers:
        compositions = Composition.query.filter_by(composer_id=composer.id).order_by(Composition.year).all()
        id = composer.id
        name = composer.name
        lifetime = composer.lifetime
        composers_data.append({
            'id' : id,
            'name': name,
            'lifetime' : lifetime,
            'compositions': compositions
        })
    
    return render_template('index.html', composers_data=composers_data, user=current_user)

###################################################

def infoFinder(videoTitle):
    for index, char in enumerate(videoTitle):  # Find composer and composition from video title
        if char in [":", "-"]:
            composer = videoTitle[:index].strip()
            composition = videoTitle[index + 1:].strip()
            return composer, composition
    return "Unknown Composer", "Unknown Composition"

@routes.route('/index/add', methods=['GET', 'POST'])
def addComposition():
    composer, composition, url = None, None, None

    if request.method == 'POST':
        url = request.form.get('url')
        print(f"Received URL: {url}")

        if url:
            try:
                ydl_opts = {
                    "quiet": True,
                    "skip_download": True,
                }

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                    videoTitle = info.get("title", "Unknown Title")

                print(f"Video title: {videoTitle}")

                composer, composition = infoFinder(videoTitle)
                print(f"Parsed Composer: {composer}, Composition: {composition}")

            except Exception as e:
                flash(f"Error retrieving video info: {e}", category="error")

    composers = Composer.query.order_by(Composer.name).all()
    return render_template(
        "add.html",
        composer=composer,
        composition=composition,
        url=url,
        composers=composers,
        user=current_user
    )



@routes.route('/confirm', methods=['POST'])
def confirmComposition():
    composer_name = request.form.get('composer_name')
    composerLifetime = request.form.get('composerLifetime')
    composition_title = request.form.get('composition')
    compositionYear = request.form.get('compositionYear')
    url = request.form.get('url')


    if not composer_name or not composition_title or not url:
        flash("Composer, composition, URL fields are required.", category="error")
        return redirect(url_for('routes.addComposition'))

    # Check if composer exists
    existing_composer = Composer.query.filter_by(name=composer_name).first()
    if not existing_composer:
        new_composer = Composer(name=composer_name, lifetime=composerLifetime)
        db.session.add(new_composer)
        db.session.commit()
        composer_id = new_composer.id
    else:
        composer_id = existing_composer.id

    # Check for duplicate composition
    existing_composition = Composition.query.filter_by(title=composition_title, composer_id=composer_id).first()
    if existing_composition:
        flash("This composition already exists.", category="info")
        return redirect(url_for('routes.addComposition'))

    # Add new composition
    new_composition = Composition(title=composition_title, year=compositionYear, url=url, composer_id=composer_id)
    db.session.add(new_composition)
    db.session.commit()

    flash("Composition added successfully!", category="success")
    return redirect(url_for('routes.addComposition'))



@routes.route('/edit-composer', methods=['POST'])
def edit_composer():
    try:
        data = request.json
        composer_id = data['id']
        name = data['name']
        lifetime = data.get('lifetime')  

        # Fetch composer from the database
        composer = Composer.query.get(composer_id)
        print("Composer retrieved:", composer_id)

        if not composer:
            return jsonify(success=False, message="Composer not found"), 404

        # Update the composer details
        if name:
            composer.name = name
        if lifetime:
            composer.lifetime = lifetime

        db.session.commit()
        return jsonify(success=True, message="Composer updated successfully")
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, message=str(e)), 500


@routes.route('/edit-composition', methods=['POST'])
def edit_composition():
    try:
        data = request.json
        composition_id = data['id']
        title = data['title']
        year = data['year']
        url = data['url']

        composition = Composition.query.get(composition_id)
        if not composition:
            return jsonify(success=False, message="Composition not found"), 404

        if title:
            composition.title = title
        if year:
            composition.year = year
        if url:
            composition.url = url

        db.session.commit()
        return jsonify(success=True, message="Composition updated successfully")
    except Exception as e:
        db.session.rollback()
        return jsonify(success=False, message=str(e)), 500

@routes.route('/delete-composer', methods=['POST'])
def delete_composer():
    data = request.get_json()
    composer_id = data.get('id')

    composer = Composer.query.get(composer_id)
    if composer:
        db.session.delete(composer)
        db.session.commit()
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Composer not found'})

@routes.route('/delete-composition', methods=['POST'])
def delete_composition():
    data = request.get_json()
    composition_id = data.get('id')

    composition = Composition.query.get(composition_id)
    if composition:
        db.session.delete(composition)
        db.session.commit()
        return jsonify({'success': True})
    return jsonify({'success': False, 'message': 'Composition not found'})
