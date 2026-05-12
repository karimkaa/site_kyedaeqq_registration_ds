from flask import Flask, request, jsonify, redirect, send_from_directory
from flask_cors import CORS
import sqlite3
import requests
import os
from werkzeug.utils import secure_filename
import random
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

DB_FILE = 'users.db'

recovery_codes = {}

# Yandex OAuth
YANDEX_CLIENT_ID     = '727fcfbc17eb48fd897fbeb085761404'
YANDEX_CLIENT_SECRET = '9b07f8b215284107b64bd0b872fdb5d3'

# Google OAuth
GOOGLE_CLIENT_ID     = "319592663812-ocrur4quh8j8vpikd10snhgvq87u7f2f.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = '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'

# =========================================================

REDIRECT_URI_YANDEX = "http://127.0.0.1:5000/auth/yandex/callback"
REDIRECT_URI_GOOGLE = "http://127.0.0.1:5000/auth/google/callback"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password TEXT,
            google_id TEXT UNIQUE
        )
    ''')
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN avatar TEXT')
    except sqlite3.OperationalError:
        pass
        
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN bio TEXT')
    except sqlite3.OperationalError:
        pass
        
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN phone TEXT')
    except sqlite3.OperationalError:
        pass
        
    try:
        cursor.execute('ALTER TABLE users ADD COLUMN birthdate TEXT')
    except sqlite3.OperationalError:
        pass

    # Messages Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_email TEXT NOT NULL,
            recipient_email TEXT NOT NULL,
            text TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    try:
        cursor.execute('ALTER TABLE messages ADD COLUMN timestamp DATETIME DEFAULT CURRENT_TIMESTAMP')
    except sqlite3.OperationalError:
        pass

    conn.commit()
    conn.close()

init_db()

# --- HTML, CSS, JS ---
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    if os.path.exists(path):
        return send_from_directory('.', path)
    return "Not Found", 404
# --------------------------------------------------

@app.route('/register', methods=['POST'])
def register():
    data = request.json
    name = data.get('name')
    email = data.get('email')
    password = data.get('password')
    captcha_response = data.get('captcha')

    if not name or not email or not password:
        return jsonify({'error': 'Все поля обязательны'}), 400

    if not captcha_response:
        return jsonify({'error': 'Капча не пройдена'}), 400

    # Verify CAPTCHA
    recaptcha_secret = '6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe'
    payload = {
        'secret': recaptcha_secret,
        'response': captcha_response
    }
    try:
        r = requests.post('https://www.recaptcha.net/recaptcha/api/siteverify', data=payload)
        result = r.json()
        if not result.get('success'):
            return jsonify({'error': 'Ошибка проверки капчи: попробуйте еще раз'}), 400
    except Exception as e:
        return jsonify({'error': 'Не удалось проверить капчу'}), 500

    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO users (name, email, password) VALUES (?, ?, ?)',
            (name, email, password)
        )
        conn.commit()
        conn.close()
        return jsonify({'message': 'Пользователь успешно зарегистрирован', 'email': email, 'name': name}), 201
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Пользователь с таким email уже существует'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({'error': 'Введите email и пароль'}), 400

    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT id, name, password, email, avatar, bio, phone, birthdate FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()

        if user and user[2] == password:
            return jsonify({
                'message': 'Успешный вход', 
                'name': user[1],
                'email': user[3],
                'avatar': user[4] or '',
                'bio': user[5] or '',
                'phone': user[6] or '',
                'birthdate': user[7] or ''
            }), 200
        else:
            return jsonify({'error': 'Неверный email или пароль'}), 401
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/forgot_password', methods=['POST'])
def forgot_password():
    data = request.json
    email = data.get('email')
    if not email:
        return jsonify({'error': 'Введите email'}), 400
    
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        user = cursor.fetchone()
        conn.close()
        
        if not user:
            return jsonify({'error': 'Пользователь не найден'}), 404
            
        code = str(random.randint(100000, 999999))
        recovery_codes[email] = code
        print(f"[{email}] Recovery code: {code}")
        
        # Send email
        try:
            sender_email = "your_email@gmail.com"
            sender_password = "your_app_password"
            
            msg = MIMEMultipart()
            msg['From'] = sender_email
            msg['To'] = email
            msg['Subject'] = "Восстановление пароля"
            
            body = f"Ваш код для восстановления пароля: {code}\nНикому не сообщайте этот код."
            msg.attach(MIMEText(body, 'plain'))
            
            server = smtplib.SMTP('smtp.gmail.com', 587)
            server.starttls()
            server.login(sender_email, sender_password)
            server.send_message(msg)
            server.quit()
        except Exception as e:
            print(f"Ошибка отправки email: {e}. Код: {code}")
            # Fallback if email fails
            
        return jsonify({'message': 'Код отправлен на почту'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/reset_password', methods=['POST'])
def reset_password():
    data = request.json
    email = data.get('email')
    code = data.get('code')
    new_password = data.get('new_password')
    
    if not email or not code or not new_password:
        return jsonify({'error': 'Все поля обязательны'}), 400
        
    if recovery_codes.get(email) != code:
        return jsonify({'error': 'Неверный код'}), 400
        
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('UPDATE users SET password = ? WHERE email = ?', (new_password, email))
        conn.commit()
        conn.close()
        
        # Clean up
        if email in recovery_codes:
            del recovery_codes[email]
            
        return jsonify({'message': 'Пароль успешно изменен'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/update_profile', methods=['POST'])
def update_profile():
    data = request.json
    email = data.get('email')
    avatar = data.get('avatar')
    bio = data.get('bio')
    phone = data.get('phone')
    name = data.get('name')
    birthdate = data.get('birthdate')
    password = data.get('password')

    if not email:
        return jsonify({'error': 'Email не указан'}), 400

    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        
        update_fields = []
        params = []
        if avatar is not None:
            update_fields.append('avatar = ?')
            params.append(avatar)
        if bio is not None:
            update_fields.append('bio = ?')
            params.append(bio)
        if phone is not None:
            update_fields.append('phone = ?')
            params.append(phone)
        if name is not None:
            update_fields.append('name = ?')
            params.append(name)
        if birthdate is not None:
            update_fields.append('birthdate = ?')
            params.append(birthdate)
        if password: # Update password only if provided
            update_fields.append('password = ?')
            params.append(password)
            
        if update_fields:
            query = f"UPDATE users SET {', '.join(update_fields)} WHERE email = ?"
            params.append(email)
            cursor.execute(query, params)
            
        conn.commit()
        conn.close()
        return jsonify({'message': 'Профиль успешно сохранен'}), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/upload_avatar', methods=['POST'])
def upload_avatar():
    if 'avatar' not in request.files:
        return jsonify({'error': 'Файл не найден'}), 400
    
    file = request.files['avatar']
    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400
    
    if file:
        filename = secure_filename(file.filename)
        import time
        filename = f"{int(time.time())}_{filename}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], filename))
        
        avatar_url = f"/uploads/{filename}"
        return jsonify({'avatar_url': avatar_url}), 200

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- Messenger Routes ---
@app.route('/get_users')
def get_users():
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        # Get users
        cursor.execute('SELECT name, email, avatar FROM users')
        users = cursor.fetchall()
        conn.close()
        
        return jsonify([{
            'name': u[0],
            'email': u[1],
            'avatar': u[2] or ''
        } for u in users]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/get_active_contacts')
def get_active_contacts():
    email = request.args.get('email')
    if not email:
        return jsonify([])
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        # Find active contacts
        cursor.execute('''
            SELECT DISTINCT u.name, u.email, u.avatar 
            FROM users u
            JOIN messages m ON (u.email = m.sender_email OR u.email = m.recipient_email)
            WHERE (m.sender_email = ? OR m.recipient_email = ?)
            AND u.email != ?
        ''', (email, email, email))
        users = cursor.fetchall()
        conn.close()
        return jsonify([{
            'name': u[0],
            'email': u[1],
            'avatar': u[2] or ''
        } for u in users]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/send_message', methods=['POST'])
def send_message():
    data = request.json
    sender = data.get('sender_email')
    recipient = data.get('recipient_email')
    text = data.get('text')
    
    if not sender or not recipient or not text:
        return jsonify({'error': 'Данные неполные'}), 400
    
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        cursor.execute('INSERT INTO messages (sender_email, recipient_email, text) VALUES (?, ?, ?)', 
                       (sender, recipient, text))
        conn.commit()
        conn.close()
        return jsonify({'status': 'ok'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/get_messages')
def get_messages():
    sender = request.args.get('sender_email')
    recipient = request.args.get('recipient_email')
    
    if not sender or not recipient:
        return jsonify({'error': 'Укажите отправителя и получателя'}), 400
        
    try:
        conn = sqlite3.connect(DB_FILE)
        cursor = conn.cursor()
        # Fetch chat history
        cursor.execute('''
            SELECT sender_email, text, timestamp FROM messages 
            WHERE (sender_email = ? AND recipient_email = ?) 
               OR (sender_email = ? AND recipient_email = ?)
            ORDER BY timestamp ASC
        ''', (sender, recipient, recipient, sender))
        msgs = cursor.fetchall()
        conn.close()
        
        return jsonify([{
            'sender': m[0],
            'text': m[1],
            'time': m[2]
        } for m in msgs]), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ==================== OAUTH 2.0 ====================

@app.route('/auth/yandex/login')
def auth_yandex_login():
    url = f"https://oauth.yandex.ru/authorize?response_type=code&client_id={YANDEX_CLIENT_ID}&redirect_uri={REDIRECT_URI_YANDEX}"
    return redirect(url)

@app.route('/auth/yandex/callback')
def auth_yandex_callback():
    code = request.args.get('code')
    if not code:
        return "Ошибка: нет кода авторизации Яндекс", 400
        
    token_url = "https://oauth.yandex.ru/token"
    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'client_id': YANDEX_CLIENT_ID,
        'client_secret': YANDEX_CLIENT_SECRET
    }
    resp = requests.post(token_url, data=data).json()
    if 'error' in resp:
        return f"Ошибка Яндекс (возможно неверные ключи в app.py): {resp.get('error_description', resp['error'])}", 400
        
    access_token = resp.get('access_token')
    
    headers = {'Authorization': f'OAuth {access_token}'}
    user_data = requests.get('https://login.yandex.ru/info?format=json', headers=headers).json()
    
    email = user_data.get('default_email')
    name = user_data.get('real_name') or user_data.get('login')
    avatar_id = user_data.get('default_avatar_id')
    avatar = f"https://avatars.yandex.net/get-yapic/{avatar_id}/islands-200" if avatar_id else ""
    
    if not email:
        email = f"ya_{user_data.get('id')}@yandex.local"
        
    return save_social_user_and_redirect(email, name, avatar)

@app.route('/auth/google/login')
def auth_google_login():
    # Google OAuth
    url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?response_type=code&client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={REDIRECT_URI_GOOGLE}"
        "&scope=openid%20profile%20email"
    )
    return redirect(url)

@app.route('/auth/google/callback')
def auth_google_callback():
    code = request.args.get('code')
    if not code:
        return "Ошибка: нет кода авторизации Google", 400
        
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        'code': code,
        'client_id': GOOGLE_CLIENT_ID,
        'client_secret': GOOGLE_CLIENT_SECRET,
        'redirect_uri': REDIRECT_URI_GOOGLE,
        'grant_type': 'authorization_code'
    }
    resp = requests.post(token_url, data=data).json()
    if 'error' in resp:
        return f"Ошибка Google: {resp.get('error_description', resp['error'])}", 400
        
    access_token = resp.get('access_token')
    
    # User data
    user_info_url = "https://www.googleapis.com/oauth2/v3/userinfo"
    headers = {'Authorization': f'Bearer {access_token}'}
    user_data = requests.get(user_info_url, headers=headers).json()
    
    email = user_data.get('email')
    name = user_data.get('name')
    avatar = user_data.get('picture')
    
    if not email:
        return "Ошибка: Google не вернул email", 400
        
    return save_social_user_and_redirect(email, name, avatar)

def save_social_user_and_redirect(email, name, avatar):
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute('SELECT id, name, email, avatar, bio, phone, birthdate FROM users WHERE email = ?', (email,))
    existing = cursor.fetchone()
    
    if existing:
        db_avatar = existing[3] or avatar
        bio = existing[4] or ''
        phone = existing[5] or ''
        birthdate = existing[6] or ''
    else:
        cursor.execute('INSERT INTO users (name, email, avatar) VALUES (?, ?, ?)', (name, email, avatar))
        conn.commit()
        db_avatar = avatar
        bio = ''
        phone = ''
        birthdate = ''
        
    conn.close()
    
    html = f"""
    <html><body>
    <script>
        const userData = {{
            name: "{name}",
            email: "{email}",
            avatar: "{db_avatar}",
            bio: "{bio}",
            phone: "{phone}",
            birthdate: "{birthdate}"
        }};
        if (window.opener) {{
            window.opener.postMessage({{ type: 'OAUTH_SUCCESS', user: userData }}, '*');
            window.close();
        }} else {{
            localStorage.setItem('oauth_user', JSON.stringify(userData));
            window.location.href = '/';
        }}
    </script>
    </body></html>
    """
    return html


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
