async function findNearbyDevices() {
    try {
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
      });
  
      console.log('Device found:', device.name);
      sendDeviceToServer(device.id, device.name);
    } catch (error) {
      console.error('Bluetooth error:', error);
    }
  }
  
  function sendDeviceToServer(deviceId, deviceName) {
    fetch('/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, deviceName }),
    })
      .then(response => response.json())
      .then(data => {
        console.log('Nearby user:', data);
        displayNearbyUsers([data]); // Update UI with nearby user
      })
      .catch(error => console.error('Error discovering users:', error));
  }
  
  function displayNearbyUsers(users) {
    const userList = document.getElementById('user-list');
    userList.innerHTML = '';
    users.forEach(user => {
      const userElement = document.createElement('div');
      userElement.textContent = `${user.username} (${user.status})`;
      userElement.addEventListener('click', () => {
        openChatWithUser(user.username);
      });
      userList.appendChild(userElement);
    });
  }
   