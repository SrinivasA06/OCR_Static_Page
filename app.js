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

    // Credentials
    const supaUrlInput = document.getElementById('supaUrl');
    const supaKeyInput = document.getElementById('supaKey');
    const statusMessage = document.getElementById('statusMessage');

    let currentFile = null;

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
            handleFile(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Camera Logic
    openCameraBtn.addEventListener('click', async () => {
        try {
            streamRef = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
            cameraVideo.srcObject = streamRef;
            cameraContainer.style.display = 'block';
            openCameraBtn.style.display = 'none';
            dropZone.style.display = 'none';
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
        dropZone.style.display = 'block';
    });

    captureBtn.addEventListener('click', () => {
        if (!streamRef) return;
        const canvas = document.createElement('canvas');
        canvas.width = cameraVideo.videoWidth;
        canvas.height = cameraVideo.videoHeight;
        canvas.getContext('2d').drawImage(cameraVideo, 0, 0);

        canvas.toBlob(blob => {
            const fileName = `camera_capture_${Date.now()}.jpg`;
            const file = new File([blob], fileName, { type: 'image/jpeg' });

            // cleanup camera
            streamRef.getTracks().forEach(track => track.stop());
            streamRef = null;
            cameraContainer.style.display = 'none';
            openCameraBtn.style.display = 'block';
            dropZone.style.display = 'block';

            handleFile(file);
        }, 'image/jpeg', 0.95);
    });

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            showStatus('Please upload an image file.', 'error');
            return;
        }
        currentFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            imagePreview.src = e.target.result;
            dropZone.style.display = 'none';
            previewContainer.style.display = 'block';
            extractBtn.disabled = false;
            resultsContainer.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    // Data Parsing using Vercel Serverless Backend (OpenAI)
    async function extractWithVision(dataUrl) {
        if (window.location.protocol === 'file:') {
            throw new Error("You are opening a local file. Vercel backend APIs require a proper web server. Please test this directly on your Vercel URL!");
        }

        const response = await fetch('/api/extract', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ image: dataUrl })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Serverless API request failed.');
        }

        const data = await response.json();
        return data.parsedData;
    }

    // Extract Text using GPT Vision
    extractBtn.addEventListener('click', async () => {
        if (!currentFile) return;

        extractBtn.disabled = true;
        resultsContainer.style.display = 'none';
        loader.style.display = 'flex';
        saveBtn.disabled = true;
        showStatus('Analyzing image structure with AI Vision...', '');

        try {
            // Compress Image before sending to Vision API (prevents huge payload crashes)
            const compressedDataUrl = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    // Downscale to a max of 1500px for speed and payload size limit safety
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
                    // Draw with white background to ensure no transparent PNG issues
                    ctx.fillStyle = "white";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    // Compress to 80% JPEG
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                };
                img.onerror = reject;
                img.src = URL.createObjectURL(currentFile);
            });

            // Extract via Native GPT Vision API
            const parsedData = await extractWithVision(compressedDataUrl);

            resultTextarea.value = "Raw OCR text disabled. Data natively fetched visually via AI Vision.";
            parsedCompany.value = parsedData.company || '';
            parsedCustomerName.value = parsedData.customerName || '';
            parsedPhone.value = parsedData.phone || '';
            parsedAddress.value = parsedData.address || '';

            resultsContainer.style.display = 'block';
            saveBtn.disabled = false;
            showStatus('Native AI Vision extraction successful.', 'success');
        } catch (error) {
            console.error(error);
            showStatus('Vision Extraction failed: ' + error.message, 'error');
        } finally {
            loader.style.display = 'none';
            extractBtn.disabled = false;
        }
    });

    saveBtn.addEventListener('click', async () => {
        const supabase = getSupabase();
        if (!supabase) {
            showStatus('Please enter Supabase URL and Key first.', 'error');
            supaUrlInput.focus();
            return;
        }

        if (!currentFile) {
            showStatus('Nothing to save.', 'error');
            return;
        }

        saveBtn.disabled = true;
        showStatus('Uploading image to Supabase...', 'success');

        try {
            const fileName = `${Date.now()}-${currentFile.name.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;

            // 1. Upload to Storage
            const { data: uploadData, error: uploadError } = await supabase
                .storage
                .from('documents')
                .upload(fileName, currentFile);

            if (uploadError) throw uploadError;

            showStatus('Saving data to database...', 'success');

            // Get public URL
            const { data: publicUrlData } = supabase
                .storage
                .from('documents')
                .getPublicUrl(fileName);

            const imageUrl = publicUrlData.publicUrl;

            // 2. Insert into invoice_customers table
            const { error: dbError } = await supabase
                .from('invoice_customers')
                .insert([
                    {
                        customer_name: parsedCustomerName.value.trim(),
                        company: parsedCompany.value.trim(),
                        phone: parsedPhone.value.trim(),
                        address: parsedAddress.value.trim(),
                        image_url: imageUrl,
                        image_path: fileName
                    }
                ]);

            if (dbError) throw dbError;

            showStatus('Successfully saved to Supabase invoice_customers!', 'success');
        } catch (error) {
            console.error(error);
            showStatus('Error saving: ' + error.message, 'error');
        } finally {
            saveBtn.disabled = false;
        }
    });

    function showStatus(msg, type) {
        statusMessage.textContent = msg;
        statusMessage.className = `status-msg ${type}`;
        if (type === 'success') {
            setTimeout(() => { statusMessage.textContent = ''; }, 5000);
        }
    }
});
