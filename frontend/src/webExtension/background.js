const API_URL = 'http://localhost:8000';

const DEFAULT_SETTINGS = {
  autoDetectEnabled: true,
  highlightScams: true,
  showNotifications: true,
  scanSocialMedia: true,
  confidenceThreshold: 50
};

let autoDetectEnabled = true;

async function saveToHistory(detectionResult) {
  try {
    const result = await chrome.storage.local.get(['detectionHistory']);
    let history = result.detectionHistory || [];
    
    history.unshift({
      id: Date.now(),
      timestamp: new Date().toISOString(),
      text: detectionResult.text || 'No text',
      verdict: detectionResult.verdict,
      confidence: detectionResult.confidence,
      scam_prob: detectionResult.scam_prob,
      legit_prob: detectionResult.legit_prob,
      platform: detectionResult.platform,
      url: detectionResult.url || '',
      type: detectionResult.type || 'post'
    });
    
    if (history.length > 100) {
      history = history.slice(0, 100);
    }
    
    await chrome.storage.local.set({ detectionHistory: history });
    console.log('✅ Saved to history:', detectionResult.verdict, detectionResult.platform);
    return true;
  } catch (error) {
    console.error('Error saving to history:', error);
    return false;
  }
}

async function getHistory() {
  try {
    const result = await chrome.storage.local.get(['detectionHistory']);
    return result.detectionHistory || [];
  } catch (error) {
    return [];
  }
}

async function clearHistory() {
  try {
    await chrome.storage.local.set({ detectionHistory: [] });
    return true;
  } catch (error) {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log('ScamShield Extension Installed');
  
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  if (Object.keys(settings).length === 0 || settings.autoDetectEnabled === undefined) {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    autoDetectEnabled = DEFAULT_SETTINGS.autoDetectEnabled;
  } else {
    autoDetectEnabled = settings.autoDetectEnabled !== false;
  }
  
  const history = await chrome.storage.local.get(['detectionHistory']);
  if (!history.detectionHistory) {
    await chrome.storage.local.set({ detectionHistory: [] });
  }
  
  console.log('Background service worker initialized, auto-detect:', autoDetectEnabled);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received:', request.action);
  
  if (request.type === 'AUTO_DETECT_TOGGLED') {
    autoDetectEnabled = request.enabled;
    chrome.storage.local.set({ autoDetectEnabled: autoDetectEnabled });
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'getHistory') {
    getHistory().then(history => sendResponse({ history: history }));
    return true;
  }
  
  if (request.action === 'clearHistory') {
    clearHistory().then(success => sendResponse({ success: success }));
    return true;
  }
  
  if (request.action === 'detectText') {
    console.log('📡 Detecting text, length:', request.text?.length);
    
    if (request.manual !== true && !autoDetectEnabled) {
      sendResponse({ verdict: 'SKIPPED', message: 'Auto-detection is disabled' });
      return true;
    }
    
    const platform = request.platform || 'web';
    
    detectScam(request.text, request.url, platform, request.type || 'post')
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ error: error.message, verdict: 'ERROR' }));
    return true;
  }
  
  if (request.action === 'getStats') {
    getStats().then(stats => sendResponse(stats));
    return true;
  }
  
  if (request.action === 'getSettings') {
    getSettings().then(settings => sendResponse(settings));
    return true;
  }
  
  if (request.action === 'updateSettings') {
    updateSettings(request.settings).then(() => sendResponse({ success: true }));
    return true;
  }
});

async function detectScam(text, url, platform = 'web', type = 'post') {
  if (!autoDetectEnabled && type !== 'manual') {
    return { verdict: 'SKIPPED', confidence: 0 };
  }
  
  if (!text || text.length === 0) {
    return { verdict: 'ERROR', confidence: 0, error: 'empty_text' };
  }
  
  try {
    console.log(`📤 Calling API for ${platform}...`);
    const response = await fetch(`${API_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.substring(0, 1000),
        platform: platform,
        account_age: 365,
        posting_frequency: 1,
        url: url || null
      })
    });
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const data = await response.json();
    console.log(`🎯 API Result: ${data.verdict} (${data.confidence})`);
    
    await saveToHistory({
      text: text,
      verdict: data.verdict,
      confidence: data.confidence,
      scam_prob: data.scam_prob,
      legit_prob: data.legit_prob,
      platform: platform,
      url: url || 'unknown',
      type: type
    });
    
    return data;
  } catch (error) {
    console.error('Detection error:', error);
    return { error: error.message, verdict: 'ERROR', confidence: 0 };
  }
}

async function getStats() {
  try {
    const response = await fetch(`${API_URL}/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    return await response.json();
  } catch (error) {
    return { total_detections: 0, scam_count: 0, scam_rate: '0%', mock_mode: true };
  }
}

async function getSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  return {
    autoDetectEnabled: settings.autoDetectEnabled !== false,
    highlightScams: settings.highlightScams !== false,
    showNotifications: settings.showNotifications !== false,
    scanSocialMedia: settings.scanSocialMedia !== false,
    confidenceThreshold: settings.confidenceThreshold || 50
  };
}

async function updateSettings(newSettings) {
  const currentSettings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const updatedSettings = { ...currentSettings, ...newSettings };
  await chrome.storage.local.set(updatedSettings);
  
  if (newSettings.autoDetectEnabled !== undefined) {
    autoDetectEnabled = newSettings.autoDetectEnabled;
  }
}

console.log('ScamShield background service worker started');