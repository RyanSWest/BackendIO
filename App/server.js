const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize SQLite database
const db = new sqlite3.Database('./users.db', (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

// Create tables if they don't exist
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`);

  // Gallery table
  db.run(`CREATE TABLE IF NOT EXISTS gallery (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    filename TEXT,
    path TEXT,
    url TEXT,
    title TEXT,
    description TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES users (id)
  )`);
});

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory');
}

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Test route
app.get('/', (req, res) => res.send('Server running with SQLite'));

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email, and password required' });
    }

    // Check if user already exists
    db.get('SELECT email FROM users WHERE email = ?', [email], async (err, row) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Server error' });
      }
      
      if (row) {
        return res.status(400).json({ error: 'User already exists' });
      }

      // Create new user
      const hashed = await bcrypt.hash(password, 10);
      const userId = Date.now().toString();
      const createdAt = new Date().toISOString();

      db.run('INSERT INTO users (id, name, email, password, createdAt) VALUES (?, ?, ?, ?, ?)',
        [userId, name, email, hashed, createdAt], function(err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ error: 'Server error' });
          }
          
          res.status(201).json({
            message: 'User registered',
            user: { id: userId, name, email, createdAt }
          });
        });
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ status: 'error', message: 'Server error' });
    }
    
    if (!user) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ status: 'error', message: 'Invalid credentials' });
    }

    const { password: _, ...userSafe } = user;
    res.json({ status: 'ok', user: userSafe });
  });
});

// Upload gallery art (file or URL)
app.post('/api/gallery/upload', upload.single('art'), (req, res) => {
  console.log('=== UPLOAD DEBUG ===');
  console.log('req.body:', req.body);
  console.log('req.file:', req.file);
  
  const { email, url, title, description } = req.body;
  
  console.log('Extracted email:', email);
  
  // First get the user
  db.get('SELECT id FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      console.error('User lookup error:', err);
      return res.status(500).json({ status: 'error', message: 'User lookup error' });
    }
    
    if (!user) {
      console.log('User not found for email:', email);
      return res.status(404).json({ status: 'error', message: 'User not found' });
    }

    console.log('Found user ID:', user.id);
    const createdAt = new Date().toISOString();

    // Handle file upload
    if (req.file) {
      console.log('Processing file upload...');
      console.log('File data:', {
        filename: req.file.filename,
        path: req.file.path,
        title,
        description
      });
      
      db.run('INSERT INTO gallery (userId, type, filename, path, title, description, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [user.id, 'file', req.file.filename, req.file.path, title || 'Untitled', description || '', createdAt], 
        function(err) {
          if (err) {
            console.error('Database INSERT error:', err);
            return res.status(500).json({ status: 'error', message: 'Database insert failed' });
          }
          
          console.log('Insert successful, ID:', this.lastID);
          res.json({ status: 'ok', message: 'File uploaded' });
        });
      return;
    }

    // Handle URL upload
    if (url) {
      db.run('INSERT INTO gallery (userId, type, url, title, description, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
        [user.id, 'url', url, title || 'Untitled', description || '', createdAt], function(err) {
          if (err) {
            console.error(err);
            return res.status(500).json({ status: 'error', message: 'Server error' });
          }
          
          res.json({ status: 'ok', message: 'URL added', art: { id: this.lastID, type: 'url', url } });
        });
      return;
    }

    console.log('No file or URL found in request');
    res.status(400).json({ status: 'error', message: 'No file or URL provided' });
  });
});

// Get all uploads from all users
app.get('/api/gallery/all', (req, res) => {
  const query = `
    SELECT 
      g.*,
      u.name as userName,
      u.email as userEmail
    FROM gallery g
    JOIN users u ON g.userId = u.id
    ORDER BY g.createdAt DESC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ status: 'error', message: 'Server error' });
    }
    
    res.json({ status: 'ok', uploads: rows, count: rows.length });
  });
});

// Get user gallery
app.get('/api/gallery/:email', (req, res) => {
  const query = `
    SELECT g.* FROM gallery g
    JOIN users u ON g.userId = u.id
    WHERE u.email = ?
    ORDER BY g.createdAt DESC
  `;
  
  db.all(query, [req.params.email], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ status: 'error', message: 'Server error' });
    }
    
    if (rows.length === 0) {
      // Check if user exists
      db.get('SELECT email FROM users WHERE email = ?', [req.params.email], (err, user) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ status: 'error', message: 'Server error' });
        }
        
        if (!user) {
          return res.status(404).json({ status: 'error', message: 'User not found' });
        }
        
        res.json({ status: 'ok', gallery: [] });
      });
      return;
    }
    
    res.json({ status: 'ok', gallery: rows });
  });
});

// Get all users (for testing)
app.get('/api/users', (req, res) => {
  db.all('SELECT id, name, email, createdAt FROM users', [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Server error' });
    }
    
    res.json({ users: rows });
  });
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

// Export for Vercel
module.exports = app;

// Start server (only when running locally)
if (require.main === module) {
  app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
}