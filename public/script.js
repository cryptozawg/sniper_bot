const socket = io();

// Messaging functionality
const messages = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

sendButton.addEventListener('click', () => {
  const message = messageInput.value;
  if (message) {
    socket.emit('message', message);
    addMessage(message, 'outgoing');
    messageInput.value = '';
  }
});

socket.on('message', (msg) => {
  addMessage(msg, 'incoming');
});

function addMessage(text, type) {
  const messageElement = document.createElement('div');
  messageElement.textContent = text;
  messageElement.className = type;
  messages.appendChild(messageElement);
  messages.scrollTop = messages.scrollHeight;
}

// Find nearby users
function findNearbyUsers() {
  fetch('/api/discover', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(response => response.json())
    .then(users => {
      const userList = document.getElementById('user-list');
      userList.innerHTML = '';

      if (users.length > 0) {
        users.forEach(user => {
          const userElement = document.createElement('div');
          userElement.textContent = `${user.username}`;
          userElement.className = 'bg-gray-100 border rounded p-2 hover:bg-gray-200 cursor-pointer';
          userList.appendChild(userElement);
        });
      } else {
        const noUsers = document.createElement('p');
        noUsers.textContent = 'No cool users around you at the moment';
        noUsers.className = 'text-gray-500';
        userList.appendChild(noUsers);
      }
    })
    .catch(error => console.error('Error finding users:', error));
}
 