console.log('========================================');
console.log('🔵 ScamShield Content Script LOADED!');
console.log('📍 URL:', window.location.href);
console.log('========================================');

let scannedPosts = new WeakMap();
let observer = null;
let autoDetectEnabled = true;
let isScanning = false;
let currentPlatform = 'web';
let currentAccountAge = 365;
let currentPostsPerDay = 1.0;
let currentMetadata = {
  platform: 'web',
  accountAge: 'Unknown',
  postsPerDay: 'Unknown',
  lastActive: 'Unknown'
};
let scanRetryCount = 0;
let lastScanTime = 0;
let activeNotifications = [];

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('📨 Content script received:', request.action);

  if (request.action === 'ping') {
    sendResponse({ status: 'ready', metadata: currentMetadata });
    return true;
  }

  if (request.action === 'scanPage') {
    console.log('📄 Manual scan requested');
    if (isScanning) {
      sendResponse({ status: 'already_scanning' });
      return true;
    }
    scanAllPostsAsync();
    sendResponse({ status: 'started' });
    return true;
  }

  if (request.action === 'getProfileInfo') {
    console.log('📊 Getting profile info...');
    extractUserMetadata().then(metadata => {
      console.log('📊 Sending metadata:', metadata);
      sendResponse({ profileInfo: metadata });
    });
    return true;
  }

  if (request.action === 'clearHighlights') {
    clearHighlights();
    scannedPosts = new WeakMap();
    sendResponse({ status: 'cleared' });
    return true;
  }

  if (request.type === 'AUTO_DETECT_CHANGED') {
    autoDetectEnabled = request.enabled;
    console.log(`Auto-detect changed to: ${autoDetectEnabled}`);
    if (!autoDetectEnabled && observer) {
      observer.disconnect();
      observer = null;
    } else if (autoDetectEnabled && !observer) {
      startObserver();
      setTimeout(() => scanAllPostsAsync(), 500);
    }
    sendResponse({ success: true });
    return true;
  }
});

function detectPlatform() {
  const url = window.location.href.toLowerCase();
  if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook';
  if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
  return 'web';
}

// ============= QR LINK NOTIFICATION SYSTEM =============
function showQRNotification(qrData, status = 'scanning') {
  try {
    const existingNotifs = document.querySelectorAll('.scamshield-qr-notification');
    existingNotifs.forEach(n => n.remove());
    
    const notification = document.createElement('div');
    notification.className = 'scamshield-qr-notification';
    
    const icon = status === 'success' ? '✅' : status === 'failed' ? '❌' : '🔍';
    const title = status === 'success' ? 'QR Link Scan Complete' : 
                  status === 'failed' ? '⚠️ QR Link Alert' : 'Scanning QR Links...';
    const message = status === 'success' ? 'All QR links verified - No scams detected' :
                    status === 'failed' ? 'Potential scam detected in QR links!' :
                    `Found ${qrData.total} QR link(s) to scan...`;
    const color = status === 'success' ? '#4caf50' : status === 'failed' ? '#ff4444' : '#ff9800';
    
    let linksHtml = '';
    if (qrData.links && qrData.links.length > 0) {
      linksHtml = `<div class="scamshield-qr-links">`;
      qrData.links.forEach((link, index) => {
        const linkStatus = link.status || 'pending';
        const linkIcon = linkStatus === 'success' ? '✅' : linkStatus === 'failed' ? '❌' : '⏳';
        linksHtml += `
          <div class="scamshield-qr-link">
            <span>${linkIcon}</span>
            <span class="scamshield-qr-link-url">${link.url.substring(0, 40)}${link.url.length > 40 ? '...' : ''}</span>
            <span class="scamshield-qr-link-status" style="color: ${linkStatus === 'success' ? '#4caf50' : linkStatus === 'failed' ? '#ff4444' : '#ff9800'}">
              ${linkStatus === 'success' ? 'Safe' : linkStatus === 'failed' ? '⚠️ Scam' : 'Scanning...'}
            </span>
          </div>
        `;
      });
      linksHtml += `</div>`;
    }
    
    notification.innerHTML = `
      <div class="scamshield-qr-notification-content">
        <div class="scamshield-qr-notification-icon">${icon}</div>
        <div class="scamshield-qr-notification-body">
          <div class="scamshield-qr-notification-title" style="color: ${color}">${title}</div>
          <div class="scamshield-qr-notification-message">${message}</div>
          ${linksHtml}
        </div>
        <button class="scamshield-qr-notification-close">×</button>
      </div>
    `;
    
    notification.style.cssText = `
      position: fixed;
      top: 80px;
      right: 20px;
      z-index: 999999;
      background: linear-gradient(135deg, #1a1a2e, #16213e);
      border: 2px solid ${color};
      border-radius: 12px;
      padding: 16px 20px;
      min-width: 350px;
      max-width: 450px;
      max-height: 500px;
      overflow-y: auto;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      animation: slideInRight 0.5s ease;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #e0e0f0;
      backdrop-filter: blur(10px);
    `;
    
    const contentStyle = `
      display: flex;
      align-items: flex-start;
      gap: 12px;
    `;
    notification.querySelector('.scamshield-qr-notification-content').style.cssText = contentStyle;
    
    const iconStyle = `
      font-size: 28px;
      flex-shrink: 0;
      margin-top: 2px;
    `;
    notification.querySelector('.scamshield-qr-notification-icon').style.cssText = iconStyle;
    
    const bodyStyle = `
      flex: 1;
      min-width: 0;
    `;
    notification.querySelector('.scamshield-qr-notification-body').style.cssText = bodyStyle;
    
    const titleStyle = `
      font-size: 15px;
      font-weight: bold;
      margin-bottom: 4px;
    `;
    notification.querySelector('.scamshield-qr-notification-title').style.cssText = titleStyle;
    
    const messageStyle = `
      font-size: 13px;
      color: #e0e0f0;
      margin-bottom: 6px;
    `;
    notification.querySelector('.scamshield-qr-notification-message').style.cssText = messageStyle;
    
    const linksStyle = `
      margin: 8px 0;
      padding: 8px;
      background: rgba(255,255,255,0.05);
      border-radius: 6px;
    `;
    const linksContainer = notification.querySelector('.scamshield-qr-links');
    if (linksContainer) {
      linksContainer.style.cssText = linksStyle;
      
      const linkItems = linksContainer.querySelectorAll('.scamshield-qr-link');
      linkItems.forEach(item => {
        item.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
          font-size: 12px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
        `;
      });
      
      const linkUrls = linksContainer.querySelectorAll('.scamshield-qr-link-url');
      linkUrls.forEach(url => {
        url.style.cssText = `
          flex: 1;
          color: #b0b0d0;
          word-break: break-all;
        `;
      });
      
      const linkStatuses = linksContainer.querySelectorAll('.scamshield-qr-link-status');
      linkStatuses.forEach(status => {
        status.style.cssText = `
          font-weight: bold;
          font-size: 11px;
          white-space: nowrap;
        `;
      });
    }
    
    const closeBtn = notification.querySelector('.scamshield-qr-notification-close');
    closeBtn.style.cssText = `
      background: none;
      border: none;
      color: #9090b8;
      font-size: 20px;
      cursor: pointer;
      padding: 0 4px;
      flex-shrink: 0;
      transition: color 0.2s;
      margin-top: -4px;
    `;
    closeBtn.onmouseover = () => closeBtn.style.color = '#e0e0f0';
    closeBtn.onmouseout = () => closeBtn.style.color = '#9090b8';
    closeBtn.onclick = () => removeNotification(notification);
    
    document.body.appendChild(notification);
    activeNotifications.push(notification);
    
    // Auto-remove after 10 seconds for success/failed, 20 seconds for scanning
    const timeout = status === 'scanning' ? 20000 : 10000;
    setTimeout(() => {
      removeNotification(notification);
    }, timeout);
    
    if (!document.getElementById('scamshield-qr-styles')) {
      const style = document.createElement('style');
      style.id = 'scamshield-qr-styles';
      style.textContent = `
        @keyframes slideInRight {
          from {
            transform: translateX(120%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        @keyframes slideOutRight {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(120%);
            opacity: 0;
          }
        }
        .scamshield-qr-notification::-webkit-scrollbar {
          width: 4px;
        }
        .scamshield-qr-notification::-webkit-scrollbar-track {
          background: rgba(255,255,255,0.05);
          border-radius: 2px;
        }
        .scamshield-qr-notification::-webkit-scrollbar-thumb {
          background: ${color};
          border-radius: 2px;
        }
      `;
      document.head.appendChild(style);
    }
    
  } catch (error) {
    console.error('Error showing QR notification:', error);
  }
}

function removeNotification(notification) {
  if (!notification || !notification.parentNode) return;
  notification.style.animation = 'slideOutRight 0.3s ease forwards';
  setTimeout(() => {
    if (notification.parentNode) {
      notification.remove();
      activeNotifications = activeNotifications.filter(n => n !== notification);
    }
  }, 300);
}

async function detectQRImagesInPost(element) {
  try {
    const qrImages = [];
    
    const imgElements = element.querySelectorAll('img');
    const canvasElements = element.querySelectorAll('canvas');
    
    for (const img of imgElements) {
      const src = img.src?.toLowerCase() || '';
      const alt = img.alt?.toLowerCase() || '';
      const className = img.className?.toLowerCase() || '';
      
      let isQRImage = false;
      let reason = '';
      
      if (src.includes('qr') || src.includes('qrcode') || src.includes('bitmap')) {
        isQRImage = true;
        reason = 'URL contains QR indicator';
      }
      
      if (alt.includes('qr') || alt.includes('qrcode') || alt.includes('scan') || alt.includes('二维码')) {
        isQRImage = true;
        reason = 'Alt text contains QR indicator';
      }
      
      if (className.includes('qr') || className.includes('qrcode')) {
        isQRImage = true;
        reason = 'Class name contains QR indicator';
      }
      
      const isSquare = await isImageSquare(img);
      if (isSquare && !isQRImage) {
        isQRImage = true;
        reason = 'Square image (possible QR code)';
      }
      
      if (isQRImage) {
        qrImages.push({ img, reason, src });
        console.log(`📱 QR Code image detected: ${reason}`);
      }
    }
    
    for (const canvas of canvasElements) {
      qrImages.push({ img: canvas, reason: 'Canvas element (may contain QR code)', src: 'canvas' });
      console.log(`📱 Canvas element detected - may contain QR code`);
    }
    
    return qrImages;
  } catch (error) {
    console.error('Error in detectQRImagesInPost:', error);
    return [];
  }
}

function isImageSquare(img) {
  return new Promise((resolve) => {
    if (!img.complete) {
      img.onload = () => {
        const isSquare = Math.abs(img.naturalWidth - img.naturalHeight) < 20;
        resolve(isSquare);
      };
      img.onerror = () => resolve(false);
    } else {
      const isSquare = Math.abs(img.naturalWidth - img.naturalHeight) < 20;
      resolve(isSquare);
    }
  });
}

function extractQRLinks(text) {
  const urlPatterns = [
    /(?:https?:\/\/)?(?:www\.)?(?:appurl\.io|bit\.ly|tinyurl|qr\.co|qrs\.ly|qrurl|qrlink|qr-code|qrcode|scanqr)[\/\w.-]+/gi,
    /(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:io|ly|co|me|link|click|qr)[\/\w.-]*/gi
  ];
  
  const links = [];
  for (const pattern of urlPatterns) {
    const matches = text.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (match.toLowerCase().includes('qr') || 
            match.toLowerCase().includes('bit.ly') || 
            match.toLowerCase().includes('tinyurl') ||
            match.toLowerCase().includes('appurl.io')) {
          links.push(match);
        }
      }
    }
  }
  return links;
}

function checkForQRCodeText(text) {
  const qrPatterns = [
    /qr\s*code/i, /scan\s*this\s*qr/i, /qr\s*scan/i,
    /qr\s*payment/i, /gcash\s*qr/i, /paymaya\s*qr/i,
    /scan\s*to\s*pay/i, /qr\s*transfer/i, /bitmap/i,
    /qrcode/i, /scan.*code/i, /grab.*qr/i, /foodpanda.*qr/i,
    /scan\s*to\s*win/i, /qr\s*lottery/i, /qr\s*promo/i,
    /scan\s*to\s*claim/i, /pay\s*via\s*qr/i, /send\s*payment/i,
    /click.*qr/i, /download.*qr/i, /install.*qr/i,
    /二维码/i, /扫描二维码/i, /扫一扫/i, /支付二维码/i, /收款码/i, /付款码/i
  ];
  
  const textLower = text.toLowerCase();
  for (const pattern of qrPatterns) {
    if (pattern.test(textLower)) {
      return true;
    }
  }
  return false;
}

async function processQRLinks(text, element) {
  try {
    const hasQRText = checkForQRCodeText(text);
    const qrLinks = extractQRLinks(text);
    
    // Only process if there are QR links
    if (qrLinks.length > 0) {
      console.log(`📱 QR content detected! Links: ${qrLinks.length}`);
      
      // Build QR data for notification - NO TEXT, ONLY LINKS
      const qrData = {
        total: qrLinks.length,
        links: [],
        postText: '' 
      };
      
      // Show scanning notification
      showQRNotification(qrData, 'scanning');
      
      let hasScam = false;
      
      for (const link of qrLinks) {
        try {
          console.log(`🔍 Scanning QR link: ${link}`);
          
          const response = await chrome.runtime.sendMessage({
            action: 'detectQR',
            url: link,
            text: text,
            platform: detectPlatform()
          });
          
          if (response && response.success) {
            const isScam = response.isScam || false;
            qrData.links.push({
              url: link,
              status: isScam ? 'failed' : 'success'
            });
            if (isScam) hasScam = true;
            console.log(`✅ QR link scan ${isScam ? 'failed (scam)' : 'successful'}: ${link}`);
          } else {
            qrData.links.push({
              url: link,
              status: 'failed'
            });
            hasScam = true;
          }
        } catch (error) {
          console.error(`Error scanning QR link ${link}:`, error);
          qrData.links.push({
            url: link,
            status: 'failed'
          });
          hasScam = true;
        }
      }
      
      setTimeout(() => {
        const existingNotifs = document.querySelectorAll('.scamshield-qr-notification');
        existingNotifs.forEach(n => n.remove());
        
        showQRNotification(qrData, hasScam ? 'failed' : 'success');
      }, 1000);
      
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error processing QR links:', error);
    return false;
  }
}

async function extractUserMetadata() {
  const platform = detectPlatform();
  const metadata = {
    platform: platform,
    accountAge: 'Unknown',
    postsPerDay: 'Unknown',
    lastActive: 'Unknown',
    profileText: ''
  };
  
  console.log(`🔍 Extracting metadata for ${platform}...`);
  
  if (platform === 'facebook') {
    const nameEl = document.querySelector('[data-testid="profile_name"], h1');
    if (nameEl) {
      metadata.profileText = nameEl.innerText?.trim() || '';
      console.log('Found profile name:', metadata.profileText);
    }
    
    const bioEl = document.querySelector('[data-testid="profile_description"]');
    if (bioEl) {
      metadata.profileText += ' ' + (bioEl.innerText?.trim() || '');
    }
    
    const bodyText = document.body.innerText;
    const joinMatch = bodyText.match(/Joined\s+(\w+\s+\d{4})/i);
    if (joinMatch) {
      metadata.accountAge = joinMatch[1];
      console.log('Found join date:', metadata.accountAge);
    } else {
      const memberMatch = bodyText.match(/Member\s+since\s+(\w+\s+\d{4})/i);
      if (memberMatch) {
        metadata.accountAge = memberMatch[1];
        console.log('Found member since:', metadata.accountAge);
      }
    }
    
    const activeMatch = bodyText.match(/Active\s+(\d+)\s+(hours?|days?|minutes?)\s+ago/i);
    if (activeMatch) {
      metadata.lastActive = `${activeMatch[1]} ${activeMatch[2]} ago`;
      console.log('Found last active:', metadata.lastActive);
    }
    
  } else if (platform === 'twitter') {
    const nameEl = document.querySelector('[data-testid="UserName"]');
    if (nameEl) {
      metadata.profileText = nameEl.innerText?.trim() || '';
      console.log('Found profile name:', metadata.profileText);
    }
    
    const bioEl = document.querySelector('[data-testid="UserDescription"]');
    if (bioEl) {
      metadata.profileText += ' ' + (bioEl.innerText?.trim() || '');
    }
    
    const joinDateEl = document.querySelector('[data-testid="UserJoinDate"]');
    if (joinDateEl) {
      metadata.accountAge = joinDateEl.innerText?.trim() || 'Unknown';
      console.log('Found join date:', metadata.accountAge);
    }
  }
  
  let postCount = 0;
  if (platform === 'facebook') {
    const posts = document.querySelectorAll('[data-testid="post_message"]');
    for (const post of posts) {
      if (!post.closest('[role="comment"]')) {
        postCount++;
      }
    }
  } else if (platform === 'twitter') {
    postCount = document.querySelectorAll('[data-testid="tweet"]').length;
  }
  
  if (postCount > 0) {
    const avgPerDay = (postCount / 7).toFixed(1);
    metadata.postsPerDay = `${avgPerDay} per day (${postCount} visible)`;
    console.log('Calculated posts per day:', metadata.postsPerDay);
  }
  
  currentMetadata = metadata;
  console.log('📊 Final metadata:', metadata);
  return metadata;
}

function getFacebookPosts() {
  const posts = [];
  const postElements = document.querySelectorAll('[data-testid="post_message"], [role="article"]');
  let count = 0;
  
  for (const el of postElements) {
    if (count >= 15) break;
    if (scannedPosts.has(el)) continue;
    if (el.closest('[role="comment"]')) continue;
    if (el.closest('[aria-label="Chats"]')) continue;
    
    let text = el.innerText?.trim() || '';
    
    if (text && text.length > 5) {
      posts.push({ element: el, text: text });
      count++;
    }
  }
  return posts;
}

function getTwitterPosts() {
  const posts = [];
  const tweetElements = document.querySelectorAll('[data-testid="tweetText"], [data-testid="tweet"]');
  let count = 0;
  
  for (const el of tweetElements) {
    if (count >= 15) break;
    if (scannedPosts.has(el)) continue;
    
    let text = el.innerText?.trim() || '';
    
    if (text && text.length > 5) {
      posts.push({ element: el, text: text });
      count++;
    }
  }
  return posts;
}

async function scanAllPostsAsync() {
  const now = Date.now();
  if (isScanning) {
    console.log('Already scanning, skipping');
    return;
  }
  
  if (now - lastScanTime < 2000) {
    console.log('Too soon since last scan, skipping');
    return;
  }
  
  isScanning = true;
  lastScanTime = now;
  scanRetryCount = 0;
  
  try {
    const platform = detectPlatform();
    if (platform === 'web') {
      console.log('Not a supported platform');
      isScanning = false;
      return;
    }
    
    console.log(`🔍 Scanning ${platform} for posts...`);
    
    await extractUserMetadata();
    
    let posts = [];
    if (platform === 'facebook') {
      posts = getFacebookPosts();
    } else if (platform === 'twitter') {
      posts = getTwitterPosts();
    }
    
    const newPosts = posts.filter(p => !scannedPosts.has(p.element));
    
    if (newPosts.length === 0) {
      console.log('No new posts found');
      chrome.runtime.sendMessage({ action: 'scanComplete', count: 0 }).catch(() => {});
      isScanning = false;
      return;
    }
    
    console.log(`📊 Found ${newPosts.length} new posts to analyze`);
    chrome.runtime.sendMessage({ action: 'scanProgress', total: newPosts.length, current: 0 }).catch(() => {});
    
    let completed = 0;
    for (const post of newPosts) {
      await analyzePost(post.text, post.element);
      completed++;
      
      if (completed % 3 === 0 || completed === newPosts.length) {
        chrome.runtime.sendMessage({ action: 'scanProgress', total: newPosts.length, current: completed }).catch(() => {});
        console.log(`📊 Progress: ${completed}/${newPosts.length} posts analyzed`);
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log(`✅ Scan complete: ${completed} posts analyzed`);
    chrome.runtime.sendMessage({ action: 'scanComplete', count: completed }).catch(() => {});
    
  } catch (error) {
    console.error('Scan error:', error);
    scanRetryCount++;
    if (scanRetryCount < 3) {
      console.log(`Retrying scan (${scanRetryCount}/3) in 5 seconds...`);
      setTimeout(() => {
        if (autoDetectEnabled) {
          scanAllPostsAsync();
        }
      }, 5000);
    }
  } finally {
    isScanning = false;
  }
}

async function analyzePost(text, element) {
  if (!autoDetectEnabled) return;
  
  try {
    const platform = detectPlatform();
    
    const hasQR = await processQRLinks(text, element);
    
    if (hasQR) {
      const response = await chrome.runtime.sendMessage({
        action: 'detectText',
        text: text,
        url: window.location.href,
        platform: platform,
        account_age: 365,
        posting_frequency: 1,
        type: 'post'
      });
      
      if (response && !response.error) {
        scannedPosts.set(element, response);
        console.log(`✅ Result: ${response.verdict} (${response.confidence})`);
      }
    }
  } catch (error) {
    console.error('Error analyzing post:', error);
  }
}

function clearHighlights() {
  document.querySelectorAll('.scamshield-badge').forEach(b => b.remove());
  
  document.querySelectorAll('[style*="outline"]').forEach(el => {
    el.style.outline = '';
    el.style.backgroundColor = '';
  });
  document.querySelectorAll('img').forEach(img => {
    img.style.outline = '';
  });
  
  document.querySelectorAll('.scamshield-qr-notification').forEach(n => n.remove());
  activeNotifications = [];
}

function startObserver() {
  if (observer) return;
  observer = new MutationObserver(() => {
    if (!autoDetectEnabled) return;
    clearTimeout(window._scanTimer);
    window._scanTimer = setTimeout(() => {
      if (autoDetectEnabled) {
        scanAllPostsAsync();
      }
    }, 1500);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  console.log('👁 Observer started');
}

async function init() {
  const stored = await chrome.storage.local.get(['autoDetectEnabled']);
  autoDetectEnabled = stored.autoDetectEnabled !== false;
  currentPlatform = detectPlatform();
  
  console.log(`Platform: ${currentPlatform} | Auto-detect: ${autoDetectEnabled}`);
  
  await extractUserMetadata();
  
  if (autoDetectEnabled && currentPlatform !== 'web') {
    setTimeout(() => scanAllPostsAsync(), 3000);
    startObserver();
  }
}

init();