/* global chrome */

if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
  document.body.innerHTML = `
    <div style="padding: 20px; text-align: center; font-family: Arial, sans-serif;">
      <h3>⚠️ Extension Error</h3>
      <p>This page can only be opened as a Chrome extension popup.</p>
      <p>Please install the extension and click the extension icon.</p>
    </div>
  `;
  throw new Error('Not running in Chrome extension context');
}

const API_URL = 'http://localhost:8000';

const scanProfileBtn = document.getElementById('scanProfileBtn');
const profileScanStatus = document.getElementById('profileScanStatus');
const accountAgeSpan = document.getElementById('accountAge');
const postsPerDaySpan = document.getElementById('postsPerDay');
const lastActiveSpan = document.getElementById('lastActive');

const resultSection = document.getElementById('resultSection');
const resultIcon = document.getElementById('resultIcon');
const resultVerdict = document.getElementById('resultVerdict');
const resultConfidence = document.getElementById('resultConfidence');
const resultScamProb = document.getElementById('resultScamProb');
const resultLegitProb = document.getElementById('resultLegitProb');
const confidenceBar = document.getElementById('confidenceBar');

const REACT_APP_URL = 'http://localhost:3000'; 
const DASHBOARD_URL = `${REACT_APP_URL}/dashboard`;  
const HISTORY_URL = `${REACT_APP_URL}/history`; 

const SCAM_SAMPLE = {
  text: "GRABE! Kumita ako ng 50000 pesos sa loob ng 7 araw! DM mo ko para malaman kung paano! bit.ly/abc123",
  account_age: 30,
  posting_frequency: 15.0,
  platform: 'facebook'
};

const LEGIT_SAMPLE = {
  text: "Kumain kami ni Maria sa Jollibee kanina. Masarap pa rin ang Chickenjoy! Highly recommend ",
  account_age: 800,
  posting_frequency: 1.2,
  platform: 'facebook'
};

function displayResult(result, isScamSample = false) {
  const isScam = result.verdict === 'SCAM';
  const confidence = parseFloat(result.confidence);
  const scamProb = parseFloat(result.scam_prob);
  const legitProb = parseFloat(result.legit_prob);
  
  const color = isScam ? '#ff4444' : '#4caf50';
  const icon = isScam ? '⚠️' : '✅';
  const verdictText = isScam ? 'SCAM DETECTED' : 'SAFE - LEGITIMATE';
  
  if (resultIcon) resultIcon.textContent = icon;
  if (resultVerdict) {
    resultVerdict.textContent = verdictText;
    resultVerdict.style.color = color;
  }
  if (resultConfidence) resultConfidence.textContent = `${confidence.toFixed(1)}%`;
  if (resultScamProb) resultScamProb.textContent = `${scamProb.toFixed(1)}%`;
  if (resultLegitProb) resultLegitProb.textContent = `${legitProb.toFixed(1)}%`;
  
  if (confidenceBar) {
    confidenceBar.style.width = `${confidence}%`;
    confidenceBar.style.background = color;
  }
  
  if (resultSection) {
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  
  showToastMessage(
    isScamSample ? `⚠️ Scam Sample Result: ${verdictText} (${confidence}% confidence)` : `Result: ${verdictText}`,
    isScam ? 'error' : 'success'
  );
}

async function detectSampleText(sampleData, isScamSample) {
  const scamSampleBtn = document.getElementById('scamSampleBtn');
  const legitSampleBtn = document.getElementById('legitSampleBtn');
  const activeBtn = isScamSample ? scamSampleBtn : legitSampleBtn;
  
  if (!activeBtn) return;
  
  const originalText = activeBtn.innerHTML;
  activeBtn.innerHTML = '<span class="loading"></span> Analyzing...';
  activeBtn.disabled = true;
  
  try {
    const response = await fetch(`${API_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: sampleData.text,
        platform: sampleData.platform,
        account_age: sampleData.account_age,
        posting_frequency: sampleData.posting_frequency
      })
    });
    
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    
    const result = await response.json();
    displayResult(result, isScamSample);
    
  } catch (error) {
    console.error('Detection error:', error);
    showToastMessage(`Error: ${error.message}`, 'error');
  } finally {
    activeBtn.innerHTML = originalText;
    activeBtn.disabled = false;
  }
}

async function loadStats() {
  try {
    const response = await fetch(`${API_URL}/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');
    
    const stats = await response.json();
    
    const totalDetectionsEl = document.getElementById('totalDetections');
    const scamCountEl = document.getElementById('scamCount');
    const scamRateEl = document.getElementById('scamRate');
    const apiStatus = document.getElementById('apiStatus');
    
    if (totalDetectionsEl) totalDetectionsEl.textContent = stats.total_detections || 0;
    if (scamCountEl) scamCountEl.textContent = stats.scam_count || 0;
    if (scamRateEl) scamRateEl.textContent = stats.scam_rate || '0%';
    
    if (apiStatus) {
      if (stats.mock_mode) {
        apiStatus.innerHTML = `<div class="status-dot warning"></div><span>⚠️ Mock Mode - Training in Progress</span>`;
      } else {
        apiStatus.innerHTML = `<div class="status-dot online"></div><span>✅ API Online - Live Mode</span>`;
      }
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
    const apiStatus = document.getElementById('apiStatus');
    if (apiStatus) {
      apiStatus.innerHTML = `<div class="status-dot offline"></div><span>❌ API Offline - Start server with: uvicorn main:app --reload</span>`;
    }
  }
}

async function toggleAutoDetection() {
  const toggleBtn = document.getElementById('autoDetectToggleBtn');
  
  try {
    const currentSettings = await chrome.storage.local.get(['autoDetectEnabled']);
    const newState = !(currentSettings.autoDetectEnabled !== false);
    
    await chrome.storage.local.set({ autoDetectEnabled: newState });
    updateAutoDetectUI(newState);
    
    chrome.runtime.sendMessage({ type: 'AUTO_DETECT_TOGGLED', enabled: newState }).catch(() => {});
    
    const allTabs = await chrome.tabs.query({});
    for (const tab of allTabs) {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'AUTO_DETECT_CHANGED', enabled: newState }).catch(() => {});
      }
    }
    
    showToastMessage(newState ? 'Auto-detection ENABLED' : 'Auto-detection DISABLED', newState ? 'success' : 'error');
    
    if (toggleBtn) {
      toggleBtn.classList.add('toggle-btn-pulse');
      setTimeout(() => toggleBtn.classList.remove('toggle-btn-pulse'), 300);
    }
  } catch (error) {
    console.error('Toggle error:', error);
    showToastMessage('Error toggling auto-detection', 'error');
  }
}

function updateAutoDetectUI(enabled) {
  const toggleBtn = document.getElementById('autoDetectToggleBtn');
  if (toggleBtn) {
    toggleBtn.className = enabled ? 'active' : 'inactive';
    toggleBtn.innerHTML = `<span class="toggle-status">${enabled ? '✅ ON' : '⛔ OFF'}</span>`;
  }
}

async function loadAutoDetectSetting() {
  try {
    const settings = await chrome.storage.local.get(['autoDetectEnabled']);
    const autoDetectEnabled = settings.autoDetectEnabled !== false;
    updateAutoDetectUI(autoDetectEnabled);
    return autoDetectEnabled;
  } catch (error) {
    return true;
  }
}

function showToastMessage(message, type) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${type === 'success' ? '#22c55e' : type === 'error' ? '#f05252' : '#f59e0b'};
    color: white;
    padding: 10px 20px;
    border-radius: 8px;
    z-index: 10000;
    font-size: 14px;
    font-weight: bold;
    animation: fadeInOut 2s ease;
    white-space: nowrap;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2000);
}

function showProfileStatus(message, type) {
  if (profileScanStatus) {
    profileScanStatus.textContent = message;
    profileScanStatus.className = `profile-scan-status ${type}`;
    profileScanStatus.style.display = 'block';
    setTimeout(() => {
      profileScanStatus.style.display = 'none';
    }, 5000);
  }
}

function updateProfileInfo(accountAge, postsPerDay, lastActive) {
  if (accountAgeSpan) accountAgeSpan.textContent = accountAge;
  if (postsPerDaySpan) postsPerDaySpan.textContent = postsPerDay;
  if (lastActiveSpan) lastActiveSpan.textContent = lastActive;
  console.log('Profile info updated:', { accountAge, postsPerDay, lastActive });
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function isContentScriptReady(tabId) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false);
        } else if (response && response.status === 'ready') {
          resolve(true);
        } else {
          resolve(false);
        }
      });
    } catch (error) {
      resolve(false);
    }
  });
}

async function loadProfileInfoOnOpen() {
  try {
    console.log('🔄 Loading profile info on popup open...');
    const tab = await getCurrentTab();
    if (!tab || !tab.id) {
      console.log('No active tab');
      return;
    }
    
    const url = tab.url || '';
    if (!url.includes('facebook.com') && !url.includes('twitter.com') && !url.includes('x.com')) {
      console.log('Not a social media page:', url);
      return;
    }
    
    console.log('Social media page detected:', url);
    
    let isReady = false;
    for (let i = 0; i < 3; i++) {
      isReady = await isContentScriptReady(tab.id);
      if (isReady) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    if (!isReady) {
      console.log('Content script not ready');
      updateProfileInfo('Refresh page', 'Refresh page', 'Refresh page');
      return;
    }
    
    const response = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getProfileInfo' }, (response) => {
        resolve(response);
      });
    });
    
    if (response && response.profileInfo) {
      console.log('✅ Received metadata:', response.profileInfo);
      updateProfileInfo(
        response.profileInfo.accountAge || 'Unknown',
        response.profileInfo.postsPerDay || 'Unknown',
        response.profileInfo.lastActive || 'Unknown'
      );
    } else {
      console.log('No profile info received');
      updateProfileInfo('Not found', 'Not found', 'Not found');
    }
  } catch (error) {
    console.error('Error loading profile info:', error);
    updateProfileInfo('Error', 'Error', 'Error');
  }
}

async function scanCurrentProfile() {
  if (!scanProfileBtn) return;
  
  const originalText = scanProfileBtn.innerHTML;
  scanProfileBtn.innerHTML = '<span class="loading"></span> Scanning posts...';
  scanProfileBtn.disabled = true;
  showProfileStatus('🔍 Scanning posts on this page...', 'info');
  
  try {
    const tab = await getCurrentTab();
    if (!tab || !tab.id) {
      showProfileStatus('Cannot scan: No active tab found', 'error');
      scanProfileBtn.innerHTML = originalText;
      scanProfileBtn.disabled = false;
      return;
    }
    
    const url = tab.url || '';
    const isSocialMedia = url.includes('facebook.com') || url.includes('twitter.com') || url.includes('x.com');
    
    if (!isSocialMedia) {
      showProfileStatus('This feature only works on Facebook or Twitter', 'error');
      scanProfileBtn.innerHTML = originalText;
      scanProfileBtn.disabled = false;
      return;
    }
    
    let isReady = false;
    for (let i = 0; i < 3; i++) {
      isReady = await isContentScriptReady(tab.id);
      if (isReady) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    if (!isReady) {
      showProfileStatus('Please refresh the page and try again', 'error');
      scanProfileBtn.innerHTML = originalText;
      scanProfileBtn.disabled = false;
      return;
    }
    
    const profileResponse = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: 'getProfileInfo' }, (response) => {
        resolve(response);
      });
    });
    
    if (profileResponse && profileResponse.profileInfo) {
      updateProfileInfo(
        profileResponse.profileInfo.accountAge || 'Unknown',
        profileResponse.profileInfo.postsPerDay || 'Unknown',
        profileResponse.profileInfo.lastActive || 'Unknown'
      );
    }
    
    chrome.tabs.sendMessage(tab.id, { action: 'scanPage', manual: true });
    
    showProfileStatus('✅ Scan started! Results will appear in history.', 'success');
    scanProfileBtn.innerHTML = '✅ Started!';
    setTimeout(() => {
      scanProfileBtn.innerHTML = originalText;
      scanProfileBtn.disabled = false;
    }, 2000);
    
  } catch (error) {
    console.error('Scan failed:', error);
    showProfileStatus(`Scan failed: ${error.message}`, 'error');
    scanProfileBtn.innerHTML = originalText;
    scanProfileBtn.disabled = false;
  }
}

async function sendToCurrentTab(action, data = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { action: action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
        } else {
          resolve(response);
        }
      });
    });
  }
  return null;
}

async function manualScanPage() {
  const scanBtn = document.getElementById('scanPageBtn');
  if (!scanBtn) return;
  
  const originalText = scanBtn.innerHTML;
  scanBtn.innerHTML = '<span class="loading"></span> Scanning...';
  scanBtn.disabled = true;
  
  try {
    showToastMessage('Scanning page content...', 'info');
    await sendToCurrentTab('scanPage', { manual: true });
    showToastMessage('Page scan completed!', 'success');
  } catch (error) {
    console.error('Manual scan failed:', error);
    showToastMessage('Scan failed. Try refreshing the page.', 'error');
  } finally {
    scanBtn.innerHTML = originalText;
    scanBtn.disabled = false;
  }
}

async function clearHighlights() {
  await sendToCurrentTab('clearHighlights');
  showToastMessage('Highlights cleared!', 'success');
}

function openDashboard() {
  chrome.tabs.create({ url: DASHBOARD_URL, active: true });
}

function openHistory() {
  chrome.tabs.create({ url: HISTORY_URL, active: true });
}

function openSettings() {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('settings.html'));
  }
}

function setupSampleButtons() {
  const scamSampleBtn = document.getElementById('scamSampleBtn');
  const legitSampleBtn = document.getElementById('legitSampleBtn');
  
  if (scamSampleBtn) {
    scamSampleBtn.addEventListener('click', () => {
      detectSampleText(SCAM_SAMPLE, true);
    });
  }
  
  if (legitSampleBtn) {
    legitSampleBtn.addEventListener('click', () => {
      detectSampleText(LEGIT_SAMPLE, false);
    });
  }
}

async function testApiConnection() {
  try {
    const response = await fetch(`${API_URL}/health`, { method: 'GET' });
    if (response.ok) {
      console.log('✅ API connection successful');
      return true;
    }
  } catch (error) {
    console.log('⚠️ API not reachable:', error.message);
  }
  return false;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanProgress') {
    if (profileScanStatus) {
      showProfileStatus(`📊 Scanning: ${request.current}/${request.total}`, 'info');
    }
  }
  if (request.action === 'scanComplete') {
    console.log(`🎉 Scan complete: ${request.count} posts`);
    if (profileScanStatus) {
      showProfileStatus(`✅ Scan complete! ${request.count} posts analyzed and saved to history`, 'success');
    }
  }
});

const style = document.createElement('style');
style.textContent = `
  @keyframes fadeInOut {
    0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
    15% { opacity: 1; transform: translateX(-50%) translateY(0); }
    85% { opacity: 1; transform: translateX(-50%) translateY(0); }
    100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
  }
`;
document.head.appendChild(style);

if (scanProfileBtn) {
  scanProfileBtn.addEventListener('click', scanCurrentProfile);
}

const toggleBtn = document.getElementById('autoDetectToggleBtn');
if (toggleBtn) {
  toggleBtn.addEventListener('click', toggleAutoDetection);
}

const scanPageBtn = document.getElementById('scanPageBtn');
if (scanPageBtn) {
  scanPageBtn.addEventListener('click', manualScanPage);
}

const clearHighlightsBtn = document.getElementById('clearHighlightsBtn');
if (clearHighlightsBtn) {
  clearHighlightsBtn.addEventListener('click', clearHighlights);
}

const openDashboardBtn = document.getElementById('openDashboard');
if (openDashboardBtn) {
  openDashboardBtn.addEventListener('click', openDashboard);
}

const openHistoryBtn = document.getElementById('openHistory');
if (openHistoryBtn) {
  openHistoryBtn.addEventListener('click', openHistory);
}

const openSettingsBtn = document.getElementById('openSettings');
if (openSettingsBtn) {
  openSettingsBtn.addEventListener('click', openSettings);
}

loadAutoDetectSetting();
loadStats();
setupSampleButtons();
testApiConnection();
loadProfileInfoOnOpen();

setInterval(loadStats, 5000);