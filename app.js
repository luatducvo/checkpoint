// Global Error Catcher for easier debugging on user side
window.onerror = function (message, source, lineno, colno, error) {
    // Show a danger toast notification visually to the user
    showToast(`Lỗi hệ thống: ${message} (Dòng ${lineno})`, 'danger');
    console.error("Global Error Caught:", error || message);
    return false;
};

// State Management
let markers = [];
let currentType = 'matterport';
let zoom = 1.0;

// Dragging map variables
let isPanning = false;
let startX, startY, scrollLeft, scrollTop;
let clickPrevented = false;

// Dragging markers variables
let activeDraggedMarker = null;
let dragStartX = 0;
let dragStartY = 0;
let markerOriginalX = 0;
let markerOriginalY = 0;

// IndexedDB storage settings
const dbName = "SitemapPlannerDB";
const storeName = "sitemaps";
const bgKey = "background_image";

function getDB() {
    return new Promise((resolve, reject) => {
        try {
            if (!window.indexedDB) {
                reject(new Error("IndexedDB không được hỗ trợ trên trình duyệt này."));
                return;
            }
            const request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
            request.onerror = (e) => reject(e.target.error);
        } catch (err) {
            reject(err);
        }
    });
}

async function saveBgImage(dataUrl) {
    try {
        const db = await getDB();
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.put(dataUrl, bgKey);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("IndexedDB error saving image:", e);
        throw e; // Rethrow to let caller catch it
    }
}

async function loadBgImage() {
    try {
        const db = await getDB();
        const tx = db.transaction(storeName, "readonly");
        const store = tx.objectStore(storeName);
        const req = store.get(bgKey);
        return new Promise((resolve, reject) => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    } catch (e) {
        console.error("IndexedDB error loading image:", e);
        return null;
    }
}

async function deleteBgImage() {
    try {
        const db = await getDB();
        const tx = db.transaction(storeName, "readwrite");
        const store = tx.objectStore(storeName);
        store.delete(bgKey);
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("IndexedDB error deleting image:", e);
        throw e;
    }
}

// DOM Elements variables (assigned during init() when DOM is fully loaded)
let viewport, mapContainer, markersOverlay, btnMatterport, btnPano, countMpEl, countPanoEl;
let editModal, modalClose, modalCancel, modalSave, modalDeleteBtn, editIdInput, editNameInput, editTypeSelect, editElevationInput, editNotesInput;
let mapImg, resetBgBtn, uploadBgBtn, bgFileInput;

// Load initial markers from LocalStorage
function init() {
    // 1. Query all UI elements and validate
    try {
        viewport = document.getElementById('map-viewport');
        mapContainer = document.getElementById('map-container');
        markersOverlay = document.getElementById('markers-overlay');
        btnMatterport = document.getElementById('btn-matterport');
        btnPano = document.getElementById('btn-pano');
        countMpEl = document.getElementById('count-mp');
        countPanoEl = document.getElementById('count-pano');

        editModal = document.getElementById('edit-modal');
        modalClose = document.getElementById('modal-close');
        modalCancel = document.getElementById('modal-cancel');
        modalSave = document.getElementById('modal-save');
        modalDeleteBtn = document.getElementById('modal-delete');
        editIdInput = document.getElementById('edit-marker-id');
        editNameInput = document.getElementById('edit-name');
        editTypeSelect = document.getElementById('edit-type');
        editElevationInput = document.getElementById('edit-elevation');
        editNotesInput = document.getElementById('edit-notes');
        
        mapImg = document.getElementById('dollhouse-map-img');
        resetBgBtn = document.getElementById('btn-reset-bg');
        uploadBgBtn = document.getElementById('btn-upload-bg');
        bgFileInput = document.getElementById('file-bg-upload');
        
        const elements = {
            viewport, mapContainer, markersOverlay, btnMatterport, btnPano,
            countMpEl, countPanoEl, editModal, modalClose, modalCancel,
            modalSave, modalDeleteBtn, editIdInput, editNameInput, editTypeSelect, editElevationInput,
            editNotesInput, mapImg, resetBgBtn, uploadBgBtn, bgFileInput
        };
        
        for (let name in elements) {
            if (!elements[name]) {
                throw new Error(`Thiếu thẻ HTML có ID: ${name}`);
            }
        }
    } catch (err) {
        console.error("Lỗi khởi dựng giao diện DOM:", err);
        alert("Lỗi khởi tạo ứng dụng: " + err.message);
        return;
    }

    // 2. Load markers from localStorage
    const saved = localStorage.getItem('pagoda_markers');
    if (saved) {
        try {
            markers = JSON.parse(saved);
        } catch (e) {
            console.error('Lỗi load markers từ localStorage:', e);
            markers = [];
        }
    }
    
    // 3. Load custom background image asynchronously (non-blocking)
    loadBgImage().then(customBg => {
        if (customBg) {
            mapImg.src = customBg;
            resetBgBtn.style.display = 'block';
        }
    }).catch(err => {
        console.error('Lỗi khi load ảnh nền từ IndexedDB:', err);
    });

    // Image status handlers (no-image state)
    mapImg.addEventListener('error', () => {
        mapImg.style.display = 'none';
        mapContainer.classList.add('no-image');
    });

    mapImg.addEventListener('load', () => {
        mapImg.style.display = 'block';
        mapContainer.classList.remove('no-image');
    });

    // 4. Background Image upload handler
    uploadBgBtn.addEventListener('click', (e) => {
        e.preventDefault();
        bgFileInput.click();
    });

    bgFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            const dataUrl = evt.target.result;
            
            // Update UI immediately
            mapImg.src = dataUrl;
            resetBgBtn.style.display = 'block';
            showToast('Đã tải lên ảnh sơ đồ mới!');

            if (markers.length > 0 && confirm('Bạn có muốn xóa toàn bộ các điểm ghim cũ trên sơ đồ mới không?')) {
                markers = [];
                saveMarkers();
                renderMarkers();
                updateStats();
            }

            // Save to DB in the background
            saveBgImage(dataUrl).catch(err => {
                console.error("Không thể lưu ảnh nền vào IndexedDB:", err);
                showToast("Lưu ý: Không thể tự động lưu ảnh nền cho lần sau (ảnh quá lớn).", "danger");
            });
        };
        reader.readAsDataURL(file);
        e.target.value = ''; // Reset file input
    });

    resetBgBtn.addEventListener('click', () => {
        if (confirm('Bạn có chắc chắn muốn đặt lại ảnh nền sơ đồ mặc định không?')) {
            mapImg.src = 'pagoda_dollhouse.png';
            resetBgBtn.style.display = 'none';
            showToast('Đã khôi phục ảnh sơ đồ mặc định');
            
            deleteBgImage().catch(err => {
                console.error("Không thể xóa ảnh nền khỏi IndexedDB:", err);
            });
        }
    });
    
    // Set active button
    btnMatterport.addEventListener('click', () => setMarkerType('matterport'));
    btnPano.addEventListener('click', () => setMarkerType('pano'));
    
    // Map click and panning
    setupMapPanning();
    setupMarkersOverlayClick();
    
    // Zoom actions
    document.getElementById('btn-zoom-in').addEventListener('click', zoomIn);
    document.getElementById('btn-zoom-out').addEventListener('click', zoomOut);
    document.getElementById('btn-zoom-reset').addEventListener('click', zoomReset);
    
    // Modal actions
    modalClose.addEventListener('click', hideModal);
    modalCancel.addEventListener('click', hideModal);
    modalSave.addEventListener('click', saveModalData);
    modalDeleteBtn.addEventListener('click', () => {
        const id = editIdInput.value;
        if (id) {
            const marker = markers.find(m => m.id === id);
            const name = marker ? marker.name : 'này';
            if (confirm(`Bạn có chắc chắn muốn xóa điểm ghim ${name} không?`)) {
                deleteMarker(id);
                hideModal();
            }
        }
    });
    
    // Export / Import / Clear
    document.getElementById('btn-export-img').addEventListener('click', exportAnnotatedImage);
    document.getElementById('btn-clear-all').addEventListener('click', clearAllMarkers);
    
    // Render
    renderMarkers();
    updateStats();
    
    // Center map view initially
    setTimeout(() => {
        zoomReset();
    }, 200);
}

// Set active marker type to place
function setMarkerType(type) {
    currentType = type;
    if (type === 'matterport') {
        btnMatterport.classList.add('active');
        btnPano.classList.remove('active');
    } else {
        btnMatterport.classList.remove('active');
        btnPano.classList.add('active');
    }
}

// Setup Map Panning (drag to scroll)
function setupMapPanning() {
    viewport.addEventListener('mousedown', (e) => {
        // Prevent panning if user clicked on modal or a marker
        if (e.target.closest('.map-marker') || e.target.closest('.modal') || e.target.closest('.sidebar')) {
            return;
        }
        isPanning = true;
        viewport.style.cursor = 'grabbing';
        startX = e.pageX - viewport.offsetLeft;
        startY = e.pageY - viewport.offsetTop;
        scrollLeft = viewport.scrollLeft;
        scrollTop = viewport.scrollTop;
    });

    viewport.addEventListener('mouseleave', () => {
        if (isPanning) {
            isPanning = false;
            viewport.style.cursor = 'grab';
        }
    });

    viewport.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            viewport.style.cursor = 'grab';
        }
    });

    viewport.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        e.preventDefault();
        const x = e.pageX - viewport.offsetLeft;
        const y = e.pageY - viewport.offsetTop;
        const walkX = (x - startX) * 1.2;
        const walkY = (y - startY) * 1.2;
        
        if (Math.abs(walkX) > 6 || Math.abs(walkY) > 6) {
            clickPrevented = true; // Dragged enough to cancel the click marker placement
        }
        viewport.scrollLeft = scrollLeft - walkX;
        viewport.scrollTop = scrollTop - walkY;
    });
}

// Click on map to add a marker
function setupMarkersOverlayClick() {
    markersOverlay.addEventListener('mouseup', (e) => {
        if (clickPrevented) {
            clickPrevented = false;
            return;
        }
        // Check if map image is successfully loaded (not no-image class)
        if (mapContainer.classList.contains('no-image')) {
            showToast('Vui lòng tải ảnh sơ đồ lên trước khi thêm điểm ghim.', 'danger');
            return;
        }
        // Check if clicked directly on overlay (not on an existing marker)
        if (e.target === markersOverlay) {
            const rect = markersOverlay.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            addMarker(x, y);
        }
    });
}

// Add a marker at percentage position
function addMarker(x, y) {
    const mpCount = markers.filter(m => m.type === 'matterport').length;
    const panoCount = markers.filter(m => m.type === 'pano').length;
    
    let defaultName = '';
    if (currentType === 'matterport') {
        defaultName = `MP-${String(mpCount + 1).padStart(2, '0')}`;
    } else {
        defaultName = `PANO-${String(panoCount + 1).padStart(2, '0')}`;
    }
    
    const newMarker = {
        id: Date.now().toString(),
        x: x,
        y: y,
        name: defaultName,
        type: currentType,
        elevation: 'Sân vườn / Ngoại cảnh',
        notes: ''
    };
    
    markers.push(newMarker);
    saveMarkers();
    renderMarkers();
    updateStats();
    
    // Show toast message
    showToast(`Đã thêm điểm ${newMarker.name}`);
    
    // Automatically open edit modal to let user name/detail it immediately
    setTimeout(() => {
        openEditModal(newMarker);
    }, 100);
}

// Save markers to local storage
function saveMarkers() {
    localStorage.setItem('pagoda_markers', JSON.stringify(markers));
}

// Render markers on the overlay
function renderMarkers() {
    markersOverlay.innerHTML = '';
    
    markers.forEach(marker => {
        const markerEl = document.createElement('div');
        markerEl.className = `map-marker ${marker.type}-marker`;
        markerEl.style.left = `${marker.x}%`;
        markerEl.style.top = `${marker.y}%`;
        markerEl.setAttribute('data-id', marker.id);
        
        // Label inside or text representation
        const label = document.createElement('span');
        label.className = 'map-marker-label';
        
        // Extract prefix numbers (e.g. PN-01 or MP-02)
        label.innerText = marker.name.replace('Điểm ', '');
        markerEl.appendChild(label);
        
        // Tooltip showing notes or full name
        const tooltip = document.createElement('div');
        tooltip.className = 'marker-tooltip';
        tooltip.innerHTML = `<strong>${marker.name}</strong>${marker.notes ? '<br><span style="font-weight:normal;opacity:0.8">' + marker.notes + '</span>' : ''}`;
        markerEl.appendChild(tooltip);
        
        // Bind dragging functionality
        makeMarkerDraggable(markerEl, marker);
        
        markersOverlay.appendChild(markerEl);
    });
}

// Drag & Drop Markers
function makeMarkerDraggable(markerEl, markerData) {
    markerEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        
        activeDraggedMarker = { el: markerEl, data: markerData };
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        markerOriginalX = markerData.x;
        markerOriginalY = markerData.y;
        
        document.addEventListener('mousemove', dragMarker);
        document.addEventListener('mouseup', stopDragMarker);
    });
}

function dragMarker(e) {
    if (!activeDraggedMarker) return;
    
    const rect = markersOverlay.getBoundingClientRect();
    const deltaX = e.clientX - dragStartX;
    const deltaY = e.clientY - dragStartY;
    
    // Convert pixel offset to percentage
    const pctDeltaX = (deltaX / rect.width) * 100;
    const pctDeltaY = (deltaY / rect.height) * 100;
    
    let newX = markerOriginalX + pctDeltaX;
    let newY = markerOriginalY + pctDeltaY;
    
    // Keep within bounds
    newX = Math.max(0.5, Math.min(99.5, newX));
    newY = Math.max(0.5, Math.min(99.5, newY));
    
    activeDraggedMarker.el.style.left = `${newX}%`;
    activeDraggedMarker.el.style.top = `${newY}%`;
    
    activeDraggedMarker.data.x = newX;
    activeDraggedMarker.data.y = newY;
}

function stopDragMarker(e) {
    if (!activeDraggedMarker) return;
    
    saveMarkers();
    updateStats();
    
    document.removeEventListener('mousemove', dragMarker);
    document.removeEventListener('mouseup', stopDragMarker);
    
    // Check if this was a click (moved less than 5px)
    const distance = Math.sqrt(Math.pow(e.clientX - dragStartX, 2) + Math.pow(e.clientY - dragStartY, 2));
    if (distance < 5) {
        openEditModal(activeDraggedMarker.data);
    }
    
    clickPrevented = true;
    setTimeout(() => { clickPrevented = false; }, 50);
    
    activeDraggedMarker = null;
}

// Update stats
function updateStats() {
    const mpMarkers = markers.filter(m => m.type === 'matterport');
    const panoMarkers = markers.filter(m => m.type === 'pano');
    
    countMpEl.innerText = mpMarkers.length;
    countPanoEl.innerText = panoMarkers.length;
}

// Highlight marker on map temporarily
function highlightMarkerOnMap(id) {
    const el = document.querySelector(`.map-marker[data-id="${id}"]`);
    if (el) {
        el.style.transform = 'translate(-50%, -50%) scale(1.4)';
        el.style.zIndex = '999';
        setTimeout(() => {
            el.style.transform = 'translate(-50%, -50%) scale(1)';
            el.style.zIndex = '100';
        }, 1500);
    }
}

// Delete marker
function deleteMarker(id) {
    const index = markers.findIndex(m => m.id === id);
    if (index !== -1) {
        const name = markers[index].name;
        markers.splice(index, 1);
        saveMarkers();
        renderMarkers();
        updateStats();
        showToast(`Đã xóa điểm ${name}`);
    }
}

// Zoom operations
function applyZoom() {
    mapContainer.style.transform = `scale(${zoom})`;
    document.getElementById('zoom-value').innerText = `${Math.round(zoom * 100)}%`;
}

function zoomIn() {
    if (zoom < 3.0) {
        zoom += 0.15;
        applyZoom();
    }
}

function zoomOut() {
    if (zoom > 0.4) {
        zoom -= 0.15;
        applyZoom();
    }
}

function zoomReset() {
    zoom = 1.0;
    applyZoom();
    // Center the viewport scroll
    viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2;
    viewport.scrollTop = (viewport.scrollHeight - viewport.clientHeight) / 2;
}

// Modal handling
function openEditModal(marker) {
    editIdInput.value = marker.id;
    editNameInput.value = marker.name;
    editTypeSelect.value = marker.type;
    editElevationInput.value = marker.elevation || '';
    editNotesInput.value = marker.notes || '';
    
    editModal.classList.add('show');
}

function hideModal() {
    editModal.classList.remove('show');
}

function saveModalData() {
    const id = editIdInput.value;
    const marker = markers.find(m => m.id === id);
    
    if (marker) {
        marker.name = editNameInput.value.trim() || marker.name;
        marker.type = editTypeSelect.value;
        marker.elevation = editElevationInput.value.trim() || 'Mặc định';
        marker.notes = editNotesInput.value.trim();
        
        saveMarkers();
        renderMarkers();
        updateStats();
        showToast(`Đã cập nhật điểm ${marker.name}`);
    }
    
    hideModal();
}

// Toast helper with types ('success' or 'danger')
function showToast(message, type = 'success') {
    let toast = document.querySelector('.toast');
    if (!toast) {
        toast = document.createElement('div');
        document.body.appendChild(toast);
    }
    
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation';
    
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    toast.classList.add('show');
    
    // Keep warning toasts visible longer
    const duration = type === 'success' ? 2500 : 5000;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

// Clear all markers
function clearAllMarkers() {
    if (markers.length === 0) return;
    if (confirm('Bạn có chắc chắn muốn xóa tất cả điểm chụp? Thao tác này không thể hoàn tác.')) {
        markers = [];
        saveMarkers();
        renderMarkers();
        updateStats();
        showToast('Đã xóa toàn bộ sơ đồ điểm chụp');
    }
}


// Helper to draw rounded rectangle on Canvas
function drawRoundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

// Export Annotated Image
function exportAnnotatedImage() {
    if (markers.length === 0) {
        alert('Vui lòng thêm ít nhất một điểm chụp trước khi xuất ảnh sơ đồ.');
        return;
    }
    
    const mapImg = document.getElementById('dollhouse-map-img');
    const tempImg = new Image();
    
    // Use the actual image source
    tempImg.src = mapImg.src;
    
    showToast('Đang tạo ảnh sơ đồ phân điểm...');
    
    tempImg.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = tempImg.naturalWidth;
        canvas.height = tempImg.naturalHeight;
        
        const ctx = canvas.getContext('2d');
        
        // Draw background
        ctx.drawImage(tempImg, 0, 0);
        
        // Draw each marker
        markers.forEach(marker => {
            // Calculate pixel position
            const x = (marker.x / 100) * canvas.width;
            const y = (marker.y / 100) * canvas.height;
            
            // Choose color
            const isMp = marker.type === 'matterport';
            const color = isMp ? '#00f2fe' : '#f97316';
            
            // 1. Draw pulsing glow ring
            ctx.beginPath();
            ctx.arc(x, y, 22, 0, 2 * Math.PI);
            ctx.fillStyle = color + '30'; // 18% opacity glow
            ctx.fill();
            
            // 2. Draw white outer shell
            ctx.beginPath();
            ctx.arc(x, y, 14, 0, 2 * Math.PI);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 8;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 4;
            
            // 3. Draw colored center
            ctx.beginPath();
            ctx.arc(x, y, 10, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
            
            // Reset shadows
            ctx.shadowBlur = 0;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 0;
            
            // 4. Draw label bubble next to the pin
            ctx.font = 'bold 13px "Plus Jakarta Sans", "Segoe UI", sans-serif';
            const labelText = marker.name;
            const textWidth = ctx.measureText(labelText).width;
            const boxWidth = textWidth + 16;
            const boxHeight = 24;
            const boxX = x + 20;
            const boxY = y - 12;
            
            // Draw background rectangle for tooltip text
            ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            
            drawRoundedRect(ctx, boxX, boxY, boxWidth, boxHeight, 6);
            ctx.fill();
            ctx.stroke();
            
            // Draw text label
            ctx.fillStyle = '#ffffff';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, boxX + 8, boxY + boxHeight / 2);
        });
        
        // Export & download
        try {
            const dataUrl = canvas.toDataURL('image/png');
            const link = document.createElement('a');
            link.download = 'virtual_tour_annotated_sitemap.png';
            link.href = dataUrl;
            link.click();
            showToast('Đã xuất ảnh thành công!');
        } catch (err) {
            console.error('Lỗi khi vẽ và xuất canvas:', err);
            alert('Có lỗi xảy ra khi xuất ảnh. Hãy chắc chắn rằng bạn đang mở ứng dụng từ máy chủ cục bộ.');
        }
    };
    
    tempImg.onerror = function() {
        alert('Lỗi tải ảnh nền để vẽ.');
    };
}

// Start app
window.onload = init;
