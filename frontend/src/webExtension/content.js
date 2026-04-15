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
  const postElements = document.querySelectorAll('[data-testid="post_message"]');
  let count = 0;
  
  for (const el of postElements) {
    if (count >= 15) break;
    if (scannedPosts.has(el)) continue;
    if (el.closest('[role="comment"]')) continue;
    if (el.closest('[aria-label="Chats"]')) continue;
    
    const text = el.innerText?.trim();
    if (text && text.length > 20) {
      console.log(`📝 Facebook post: "${text.substring(0, 50)}..."`);
      posts.push({ element: el, text: text });
      count++;
    }
  }
  return posts;
}

function getTwitterPosts() {
  const posts = [];
  const tweetElements = document.querySelectorAll('[data-testid="tweetText"]');
  let count = 0;
  
  for (const el of tweetElements) {
    if (count >= 15) break;
    if (scannedPosts.has(el)) continue;
    
    const text = el.innerText?.trim();
    if (text && text.length > 20) {
      console.log(`📝 Twitter post: "${text.substring(0, 50)}..."`);
      posts.push({ element: el, text: text });
      count++;
    }
  }
  return posts;
}

async function scanAllPostsAsync() {
  if (isScanning) {
    console.log('Already scanning, skipping');
    return;
  }
  
  isScanning = true;
  
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
      
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    console.log(`✅ Scan complete: ${completed} posts analyzed`);
    chrome.runtime.sendMessage({ action: 'scanComplete', count: completed }).catch(() => {});
    
  } catch (error) {
    console.error('Scan error:', error);
  } finally {
    isScanning = false;
  }
}

async function analyzePost(text, element) {
  if (!autoDetectEnabled) return;
  
  const platform = detectPlatform();
  
  try {
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
      
      if (response.verdict === 'SCAM') {
        highlightPost(element, response, text);
      }
    }
  } catch (error) {
    console.error('Error analyzing post:', error);
  }
}

function highlightPost(element, result, text) {
  element.style.outline = '2px solid #f05252';
  element.style.backgroundColor = 'rgba(240, 82, 82, 0.05)';
  
  if (!element.querySelector('.scamshield-badge')) {
    const badge = document.createElement('span');
    badge.className = 'scamshield-badge';
    badge.textContent = '⚠️ SCAM';
    badge.style.cssText = `
      display: inline-block;
      background: #f05252;
      color: white;
      font-size: 10px;
      padding: 2px 8px;
      border-radius: 4px;
      margin-left: 8px;
      cursor: pointer;
    `;
    badge.onclick = () => alert(`⚠️ SCAM DETECTED!\n\nConfidence: ${result.confidence}\n\nText: ${text.substring(0, 200)}`);
    element.prepend(badge);
  }
}

function clearHighlights() {
  document.querySelectorAll('.scamshield-badge').forEach(b => b.remove());
  document.querySelectorAll('[style*="outline"]').forEach(el => {
    el.style.outline = '';
    el.style.backgroundColor = '';
  });
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