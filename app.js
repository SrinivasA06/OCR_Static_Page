document.addEventListener('DOMContentLoaded', () => {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const previewContainer = document.getElementById('previewContainer');
    const imagePreview = document.getElementById('imagePreview');
    const extractBtn = document.getElementById('extractBtn');

    const resultsContainer = document.getElementById('resultsContainer');
    const resultTextarea = document.getElementById('resultTextarea');

    const parsedCompany = document.getElementById('parsedCompany');
    const parsedCustomerName = document.getElementById('parsedCustomerName');
    const parsedPhone = document.getElementById('parsedPhone');
    const parsedAddress = document.getElementById('parsedAddress');

    // Camera
    const openCameraBtn = document.getElementById('openCameraBtn');
    const cameraContainer = document.getElementById('cameraContainer');
    const cameraVideo = document.getElementById('cameraVideo');
    const captureBtn = document.getElementById('captureBtn');
    const cancelCameraBtn = document.getElementById('cancelCameraBtn');
    let streamRef = null;

    const loader = document.getElementById('loader');
    const saveBtn = document.getElementById('saveBtn');

    // Queue Elements
    const queueContainer = document.getElementById('queueContainer');
    const queueList = document.getElementById('queueList');

    // Credentials
    const supaUrlInput = document.getElementById('supaUrl');
    const supaKeyInput = document.getElementById('supaKey');
    const statusMessage = document.getElementById('statusMessage');

    let processingQueue = [];
    let isProcessing = false;

    // Load credentials from localStorage
    if (localStorage.getItem('supaUrl')) {
        supaUrlInput.value = localStorage.getItem('supaUrl');
    }
    if (localStorage.getItem('supaKey')) {
        supaKeyInput.value = localStorage.getItem('supaKey');
    }

    // Save credentials to localStorage on change
    supaUrlInput.addEventListener('input', () => {
        localStorage.setItem('supaUrl', supaUrlInput.value.trim());
    });
    supaKeyInput.addEventListener('input', () => {
        localStorage.setItem('supaKey', supaKeyInput.value.trim());
    });

    const getSupabase = () => {
        const url = supaUrlInput.value.trim();
        const key = supaKeyInput.value.trim();
        if (!url || !key) return null;
        return window.supabase.createClient(url, key);
    };

    // File Drag & Drop
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFiles(e.dataTransfer.files);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFiles(e.target.files);
        }
    });

    // Camera Logic
    openCameraBtn.addEventListener('click', async () => {
        try {
            streamRef = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            cameraVideo.srcObject = streamRef;
            cameraContainer.style.display = 'block';
            openCameraBtn.style.display = 'none';
        } catch (err) {
            showStatus('Camera access denied or unavailable.', 'error');
        }
    });

    cancelCameraBtn.addEventListener('click', () => {
        if (streamRef) {
            streamRef.getTracks().forEach(track => track.stop());
            streamRef = null;
        }
        cameraContainer.style.display = 'none';
        openCameraBtn.style.display = 'block';
    });

    captureBtn.addEventListener('click', () => {
        if (!streamRef) return;
        const canvas = document.createElement('canvas');
        canvas.width = cameraVideo.videoWidth;
        canvas.height = cameraVideo.videoHeight;
        canvas.getContext('2d').drawImage(cameraVideo, 0, 0);

        canvas.toBlob(blob => {
            const fileName = `capture_${Date.now()}.jpg`;
            const file = new File([blob], fileName, { type: 'image/jpeg' });

            // Visual feedback
            showStatus('Captured! Processing in background...', 'success');
            
            handleFiles([file]);
        }, 'image/jpeg', 0.95);
    });

    function handleFiles(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            
            const queueItem = {
                id: Date.now() + Math.random().toString(16).slice(2),
                file: file,
                status: 'pending',
                name: file.name
            };
            
            processingQueue.push(queueItem);
            renderQueueItem(queueItem);
        });

        queueContainer.style.display = 'block';
        if (!isProcessing) {
            processNextInQueue();
        }
    }

    function renderQueueItem(item) {
        const div = document.createElement('div');
        div.className = 'queue-item';
        div.id = `item-${item.id}`;
        div.innerHTML = `
            <div class="queue-info">
                <span class="queue-name">${item.name}</span>
                <span class="queue-status"><span class="status-badge badge-pending">Pending</span></span>
            </div>
        `;
        queueList.appendChild(div);
        queueList.scrollTop = queueList.scrollHeight;
    }

    function updateQueueItemStatus(id, status, error = null) {
        const itemEl = document.getElementById(`item-${id}`);
        if (!itemEl) return;
        
        const badge = itemEl.querySelector('.status-badge');
        badge.className = `status-badge badge-${status}`;
        badge.textContent = status === 'error' ? 'Failed' : status;
        
        if (status === 'processing') {
            itemEl.classList.add('processing');
        } else {
            itemEl.classList.remove('processing');
        }

        if (error) {
            showStatus(`${status.toUpperCase()}: ${error}`, 'error');
        }
    }

    async function processNextInQueue() {
        if (isProcessing) return;
        
        const nextItem = processingQueue.find(i => i.status === 'pending');
        if (!nextItem) {
            isProcessing = false;
            return;
        }

        isProcessing = true;
        nextItem.status = 'processing';
        updateQueueItemStatus(nextItem.id, 'processing');

        try {
            await runEtlWorkflow(nextItem);
            nextItem.status = 'done';
            updateQueueItemStatus(nextItem.id, 'done');
        } catch (err) {
            console.error(err);
            nextItem.status = 'error';
            updateQueueItemStatus(nextItem.id, 'error', err.message);
        } finally {
            isProcessing = false;
            // Short delay before next item for visual smoothness
            setTimeout(processNextInQueue, 1000);
        }
    }

    async function runEtlWorkflow(item) {
        const supabase = getSupabase();
        if (!supabase) throw new Error("Supabase credentials missing.");

        // 1. Compress
        const compressedDataUrl = await compressImage(item.file);
        
        // 2. Extract with AI
        const parsedData = await extractWithVision(compressedDataUrl);
        
        // 3. Upload File
        const fileName = `${Date.now()}-${item.file.name.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(fileName, item.file);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = supabase.storage.from('documents').getPublicUrl(fileName);
        const imageUrl = publicUrlData.publicUrl;

        // 4. Save to DB
        const { error: dbError } = await supabase.from('invoice_customers').insert([{
            customer_name: (parsedData.customerName || '').trim(),
            company: (parsedData.company || '').trim(),
            phone: (parsedData.phone || '').trim(),
            address: (parsedData.address || '').trim(),
            image_url: imageUrl,
            image_path: fileName
        }]);
        if (dbError) throw dbError;
    }

    async function compressImage(file) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_SIZE = 1500;
                if (width > height && width > MAX_SIZE) {
                    height = Math.round((height * MAX_SIZE) / width);
                    width = MAX_SIZE;
                } else if (height > MAX_SIZE) {
                    width = Math.round((width * MAX_SIZE) / height);
                    height = MAX_SIZE;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.onerror = reject;
            img.src = URL.createObjectURL(file);
        });
    }

    async function extractWithVision(dataUrl) {
        if (window.location.protocol === 'file:') {
            throw new Error("Local file:// protocol not supported. Use Vercel URL!");
        }

        const response = await fetch('/api/extract', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: dataUrl })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'AI Extraction failed.');
        }

        const data = await response.json();
        return data.parsedData;
    }

    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = `status-msg ${type}`;
        if (type === 'success') {
            setTimeout(() => { if (statusMessage.textContent === msg) statusMessage.textContent = ''; }, 5000);
        }
    }
});
