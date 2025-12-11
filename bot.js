const http = require('http');
const TelegramBot = require('node-telegram-bot-api');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ===== HEALTH CHECK SERVER =====
const PORT = process.env.PORT || 8000;

http.createServer((req, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Health check running on port ${PORT}`);
  updateYtdlp();
  startBot();
});

// ===== UPDATE YT-DLP ON STARTUP =====
function updateYtdlp() {
  try {
    console.log('Updating yt-dlp...');
    execSync('yt-dlp -U', { timeout: 60000 });
    console.log('yt-dlp updated!');
  } catch (e) {
    console.log('yt-dlp update skipped');
  }
}

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

  // Command to force update yt-dlp
  bot.onText(/\/update/, (msg) => {
    bot.sendMessage(msg.chat.id, '🔄 Updating yt-dlp...');
    exec('yt-dlp -U', { timeout: 60000 }, (err, stdout) => {
      bot.sendMessage(msg.chat.id, err ? '❌ Update failed' : '✅ Updated!\n\n' + stdout.slice(0, 200));
    });
  });

  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    if (!text || text.startsWith('/') || !SUPPORTED.test(text)) return;
    
    const status = await bot.sendMessage(chatId, '⏳ Downloading...');
    const filePath = path.join(TEMP_DIR, `${chatId}_${Date.now()}.mp4`);
    
    // Better command with more options
    const cmd = `yt-dlp \
      --no-check-certificates \
      --no-warnings \
      --prefer-free-formats \
      --add-header "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
      --add-header "Accept:text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
      -f "best[filesize<50M]/bestvideo[filesize<50M]+bestaudio/best" \
      --merge-output-format mp4 \
      --socket-timeout 30 \
      --retries 3 \
      -o "${filePath}" \
      "${text}"`;
    
    exec(cmd, { timeout: 180000 }, async (err, stdout, stderr) => {
      if (err || !fs.existsSync(filePath)) {
        console.log('Download error:', stderr || err?.message);
        
        let errorMsg = '❌ Download failed.';
        if (stderr?.includes('login') || stderr?.includes('cookies')) {
          errorMsg = '❌ This video requires login. Try a different link.';
        } else if (stderr?.includes('Private') || stderr?.includes('private')) {
          errorMsg = '❌ This video is private.';
        } else if (stderr?.includes('unavailable') || stderr?.includes('removed')) {
          errorMsg = '❌ Video unavailable or removed.';
        } else if (stderr?.includes('rate') || stderr?.includes('429')) {
          errorMsg = '❌ Too many requests. Wait a minute and try again.';
        } else {
          errorMsg = '❌ Download failed. Try:\n• Different video\n• Send /update then retry';
        }
        
        await bot.editMessageText(errorMsg, 
          { chat_id: chatId, message_id: status.message_id }).catch(() => {});
        return;
      }
      
      try {
        const stats = fs.statSync(filePath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
        
        await bot.editMessageText(`📤 Uploading (${sizeMB}MB)...`, 
          { chat_id: chatId, message_id: status.message_id });
        await bot.sendVideo(chatId, filePath, { caption: '✅ Here is your video!' });
        await bot.deleteMessage(chatId, status.message_id).catch(() => {});
      } catch (e) {
        console.log('Upload error:', e.message);
        await bot.editMessageText('❌ File too large for Telegram (50MB limit)', 
          { chat_id: chatId, message_id: status.message_id }).catch(() => {});
      }
      
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  });

  bot.on('polling_error', (err) => {
    if (err.code !== 'EFATAL') console.log('Polling error:', err.code);
  });

  console.log('Bot started successfully!');
}
