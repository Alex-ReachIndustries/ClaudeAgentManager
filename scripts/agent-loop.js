const fs = require('fs');
const path = require('path');
const msgFile = path.join(__dirname, '.agent_incoming_messages.json');

async function checkLoop() {
  while(true) {
    if (fs.existsSync(msgFile)) {
      try {
        const data = fs.readFileSync(msgFile, 'utf8');
        const messages = JSON.parse(data);
        console.log('RECEIVED_MESSAGES:', messages);
        // Delete processed file
        fs.unlinkSync(msgFile);
      } catch (err) {}
    }
    await new Promise(r => setTimeout(r, 2000));
  }
}
checkLoop();
