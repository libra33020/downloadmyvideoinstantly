const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// ===== HEALTH CHECK SERVER (Must start first!) =====
const PORT = process.env.PORT || 8000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Health check running on port ${PORT}`);
  startBot();
});

// ===== TELEGRAM BOT =====
function startBot() {
  const BOT_TOKEN = process.env.BOT_TOKEN;
  
  if (!BOT_TOKEN) {
    console.log('ERROR: BOT_TOKEN not set!');
    return;
  }

  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  const TEMP_DIR = '/tmp/videos';
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const SUPPORTED = /youtu|instagram|tiktok|facebook|fb\.watch|twitter|x\.com/i;

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 
`🎬 *Video Downloader Bot*

Send me a video link from:
• YouTube / Shorts
• Instagram Reels  
• TikTok
• Facebook
• Twitter/X

I'll send you the video! 📥`, { parse_mode: 'Markdown' });
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/') || !SUPPORTED.test(text)) return;
    
    const status = await bot.sendMessage(chatId, '⏳ Downloading...');
    const filePath = path.join(TEMP_DIR, `${chatId}_${Date.now()}.mp4`);
    
    const cmd = `yt-dlp -f "best[filesize<50M]/bestvideo[filesize<50M]+bestaudio/best" --merge-output-format mp4 -o "${filePath}" "${text}"`;
    
    exec(cmd, { timeout: 180000 }, async (err) => {
      if (err || !fs.existsSync(filePath)) {
        await bot.editMessageText('❌ Download failed. Check if video is public.', 
          { chat_id: chatId, message_id: status.message_id }).catch(() => {});
        return;
      }
      
      try {
        await bot.editMessageText('📤 Uploading...', 
          { chat_id: chatId, message_id: status.message_id });
        await bot.sendVideo(chatId, filePath, { caption: '✅ Here is your video!' });
        await bot.deleteMessage(chatId, status.message_id).catch(() => {});
      } catch (e) {
        await bot.editMessageText('❌ File too large for Telegram (50MB limit)', 
          { chat_id: chatId, message_id: status.message_id }).catch(() => {});
      }
      
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });

  bot.on('polling_error', (err) => {
    console.log('Polling error:', err.code);
  });

  console.log('Bot started successfully!');
}
