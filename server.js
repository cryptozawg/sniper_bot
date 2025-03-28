const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// MongoDB connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatapp';
console.log('[SERVER] Connecting to MongoDB with URI:', MONGODB_URI);

mongoose.connect(MONGODB_URI)
  .then(() => console.log('[SERVER] Connected to MongoDB'))
  .catch(err => console.error('[SERVER] MongoDB connection error:', err));

  // User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  location: { type: [Number], index: '2dsphere' }, // [longitude, latitude] for geolocation
});
const User = mongoose.model('User', userSchema);

// Message Schema 
const messageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, default: 'text' }, // 'text', 'image', 'video', 'voice'
  timestamp: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);

// Chat Schema (to track active chats)
const chatSchema = new mongoose.Schema({
  users: [{ type: String, required: true }],  
  lastMessage: { type: Date, default: Date.now },
});
const Chat = mongoose.model('Chat', chatSchema);

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });

  try {
    const decoded = jwt.verify(token, 'your_jwt_secret');
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Routes
app.get('/logout', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const existingUser = await User.findOne({ username });
    if (existingUser) return res.status(400).json({ error: 'Username already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, password: hashedPassword });
    await user.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error registering user' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid username or password' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ username: user.username }, 'your_jwt_secret', { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Error logging in' });
  }
});

app.get('/', verifyToken, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/userinfo', verifyToken, (req, res) => {
  res.json({ username: req.user.username });
});

app.get('/api/active-chats', verifyToken, async (req, res) => {
  const { username } = req.user;
  try {
    const chats = await Chat.find({ users: username }).sort({ lastMessage: -1 });
    const activeChats = chats.map(chat => {
      const otherUser = chat.users.find(user => user !== username);
      return otherUser;
    });
    res.json(activeChats);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching active chats' });
  }
});

app.post('/api/update-location', verifyToken, async (req, res) => {
  const { username } = req.user;
  const { location } = req.body;

  try {
    await User.updateOne({ username }, { $set: { location } });
    res.json({ message: 'Location updated' });
  } catch (error) {
    res.status(500).json({ error: 'Error updating location' });
  }
});

app.post('/api/discover', verifyToken, async (req, res) => {
  const { username } = req.user;
  try {
    const user = await User.findOne({ username });
    if (!user.location) {
      // If the user has no location, return all users except themselves (fallback)
      const users = await User.find({ username: { $ne: username } }).select('username');
      return res.json(users);
    }

    // Find users within 50km (MongoDB uses meters, so 50km = 50000m)
    const nearbyUsers = await User.find({
      username: { $ne: username },
      location: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: user.location, // [longitude, latitude]
          },
          $maxDistance: 50000, // 50km
        },
      },
    }).select('username');

    res.json(nearbyUsers);
  } catch (error) {
    res.status(500).json({ error: 'Error discovering users' });
  }
});

app.post('/api/remove-chat', verifyToken, async (req, res) => {
  const { username } = req.user;
  const { chatUsername } = req.body;

  try {
    // Delete the chat
    await Chat.deleteOne({ users: { $all: [username, chatUsername] } });
    // Delete all messages between the users
    await Message.deleteMany({
      $or: [
        { from: username, to: chatUsername },
        { from: chatUsername, to: username },
      ],
    });
    res.json({ message: 'Chat removed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error removing chat' });
  }
});

app.get('/api/chat-history/:username', verifyToken, async (req, res) => {
  const { username } = req.user;
  const { username: otherUser } = req.params;

  try {
    const messages = await Message.find({
      $or: [
        { from: username, to: otherUser },
        { from: otherUser, to: username },
      ],
    }).sort({ timestamp: 1 });

    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching chat history' });
  }
});

app.post('/upload', verifyToken, upload.single('file'), async (req, res) => {
  const { username } = req.user;
  const { receiver } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const fileUrl = `/uploads/${req.file.filename}`;
  let type = 'text';
  if (req.file.mimetype.startsWith('image')) {
    type = 'image';
  } else if (req.file.mimetype.startsWith('video')) {
    type = 'video';
  } else if (req.file.mimetype.startsWith('audio')) {
    type = 'voice';
  }

  const message = new Message({
    from: username,
    to: receiver,
    message: fileUrl,
    type,
  });
  await message.save();

  io.to(receiver).emit('message', { from: username, message: fileUrl, type });
  io.to(username).emit('message', { from: username, message: fileUrl, type });

  res.json({ fileUrl });
});

// Socket.io for real-time chat
io.on('connection', (socket) => {
  console.log('[SERVER] A user connected:', socket.id);

  socket.on('register-user', (username) => {
    socket.username = username;
    socket.join(username);
    console.log('[SERVER] User registered:', username);
  });

  socket.on('chat-request', async ({ to }) => {
    const from = socket.username;
    console.log('[SERVER] Chat request from:', from, 'to:', to);

    // Check if a chat already exists
    const existingChat = await Chat.findOne({ users: { $all: [from, to] } });
    if (existingChat) {
      socket.emit('chat-accepted', { from: to });
      return;
    }

    io.to(to).emit('chat-request', { from });
  });

  socket.on('chat-request-accepted', async ({ from }) => {
    const to = socket.username;
    console.log('[SERVER] Chat request accepted by:', to, 'from:', from);

    // Create a new chat
    const chat = new Chat({ users: [from, to] });
    await chat.save();

    io.to(from).emit('chat-accepted', { from: to });
  });

  socket.on('chat-request-denied', ({ to }) => {
    const from = socket.username;
    console.log('[SERVER] Chat request denied by:', from, 'to:', to);
    io.to(to).emit('chat-request-denied', { from });
  });

  socket.on('message', async ({ to, message, type }) => {
    const from = socket.username;
    console.log('[SERVER] Message from:', from, 'to:', to, 'Message:', message, 'Type:', type);

    const messageData = new Message({
      from,
      to,
      message,
      type,
    });
    await messageData.save();

    // Update the chat's last message timestamp
    await Chat.updateOne(
      { users: { $all: [from, to] } },
      { $set: { lastMessage: new Date() } }
    );

    io.to(to).emit('message', { from, message, type });
    io.to(from).emit('message', { from, message, type });
  });

  socket.on('disconnect', () => {
    console.log('[SERVER] User disconnected:', socket.username || 'unknown');
  });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`[SERVER] Server running on port ${PORT}`);
}); 