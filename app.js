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

    // Preprocess image for OCR (Grayscale & Contrast)
    async function preprocessImage(file) {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;

                // Draw white background
                ctx.fillStyle = "white";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);

                let imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                let d = imgData.data;
                const contrast = 60; // Increase contrast
                const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

                for (let i = 0; i < d.length; i += 4) {
                    // Grayscale
                    let avg = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
                    // Contrast
                    avg = factor * (avg - 128) + 128;

                    // Threshold (Binarize slightly)
                    // if (avg < 150) avg = 0; else avg = 255;

                    d[i] = d[i + 1] = d[i + 2] = avg;
                }

                ctx.putImageData(imgData, 0, 0);
                resolve(canvas.toDataURL('image/jpeg', 0.9));
            };
        });
    }

    // Data Parsing logic
    function parseInvoiceData(text) {
        // Levenshtein distance for fuzzy matching
        function getEditDistance(a, b) {
            if (a.length === 0) return b.length;
            if (b.length === 0) return a.length;
            const matrix = [];
            for (let i = 0; i <= b.length; i++) matrix[i] = [i];
            for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
            for (let i = 1; i <= b.length; i++) {
                for (let j = 1; j <= a.length; j++) {
                    if (b.charAt(i - 1) === a.charAt(j - 1)) {
                        matrix[i][j] = matrix[i - 1][j - 1];
                    } else {
                        matrix[i][j] = Math.min(
                            matrix[i - 1][j - 1] + 1,
                            Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                        );
                    }
                }
            }
            return matrix[b.length][a.length];
        }

        // Helper to remove duplicated columns (e.g. BILL TO and SHIP TO read as one line)
        function deduplicateLine(line) {
            line = line.trim();
            if (!line) return '';
            
            // 0. Remove the 3rd right-most column noise (TERMS, DATE, INVOICE #) before attempting center-split
            line = line.replace(/\b(DATE|TERMS|INVOICE\s*#|P\.?O\.?\s+NUMBER|BUYER)\b.*$/i, '').trim();
            
            // 1. If Tesseract left 2+ spaces, just take the left column
            let parts = line.split(/\s{2,}/);
            if (parts.length > 1 && parts[0].trim()) {
                return parts[0].trim();
            }
            
            // 2. Strict repetition regex (catches "MIMI AND RUTH MIMI AND RUTH" or without spaces)
            const exactRepeatMatch = line.match(/^(.+?)\s*\1$/i);
            if (exactRepeatMatch) return exactRepeatMatch[1].trim();

            // 3. Sliding-Window Fuzzy Deduplicator
            // Sweeps across the entire string without assuming a midpoint. It compares the left block against an equally sized chunk of the right block. This is immune to trailing Tesseract noise.
            const len = line.length;
            if (len > 10) {
                // Sweep through every possible split point horizontally
                for (let i = Math.floor(len / 4); i < len - Math.floor(len / 4); i++) {
                    const leftPart = line.substring(0, i).trim();
                    const rightPart = line.substring(i).trim();
                    
                    const leftClean = leftPart.toLowerCase().replace(/[^\w]/g, '');
                    const rightCleanFull = rightPart.toLowerCase().replace(/[^\w]/g, '');
                    
                    if (leftClean.length > 5 && rightCleanFull.length >= leftClean.length) {
                        // Extract a chunk from the right side that is precisely the same length as the left side
                        const rightCleanChunk = rightCleanFull.substring(0, leftClean.length);
                        
                        // Compare the two identically-sized chunks
                        const distance = getEditDistance(leftClean, rightCleanChunk);
                        
                        // If Edit distance is very small (allow up to 3 typos)
                        if (distance <= 3 || leftClean === rightCleanChunk) {
                            return leftPart;
                        }
                    }
                }
            }
            
            return line;
        }

        // Extract phone numbers using RegEx
        const phoneRegex = /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
        let foundPhones = text.match(phoneRegex);

        let validPhones = [];
        if (foundPhones) {
            // Filter out tracking numbers masquerading as phones
            validPhones = foundPhones.filter(p => {
                const digits = p.replace(/\D/g, '');
                return !(digits.length > 11 && !p.startsWith('+'));
            });
        }
        let phoneNumbers = validPhones.length > 0 ? [...new Set(validPhones)].join(', ') : '';

        const lines = text.split('\n').map(l => deduplicateLine(l)).filter(l => l.length > 0);

        let company = '';
        let address = [];
        let customerName = '';

        if (lines.length > 0) {
            // Find where "INVOICE" appears
            const invoiceIndex = lines.findIndex(l => l.toUpperCase().includes('INVOICE'));

            // 1. Parse from the INVOICE line downwards to find Company and Address from BILL TO
            let startIndexForCustomer = invoiceIndex > -1 ? invoiceIndex : 0;
            let billToIndex = -1;

            for (let j = startIndexForCustomer; j < lines.length; j++) {
                const upLine = lines[j].toUpperCase();
                if (upLine.includes('BILL TO') || upLine.includes('SHIP TO')) {
                    billToIndex = j;
                    break;
                }
            }

            if (billToIndex > -1 && billToIndex + 1 < lines.length) {
                company = lines[billToIndex + 1];
                let addressIndexStart = billToIndex + 2;

                const potentialName = company.toUpperCase();
                if (potentialName.includes('SHIP TO')) {
                    company = lines[billToIndex + 2] || company;
                    addressIndexStart = billToIndex + 3;
                }

                // Grab Address 
                if (addressIndexStart < lines.length) address.push(lines[addressIndexStart]);
                if (addressIndexStart + 1 < lines.length) address.push(lines[addressIndexStart + 1]);
            } else if (invoiceIndex > -1 && invoiceIndex + 1 < lines.length) {
                const nextLine = lines[invoiceIndex + 1].toUpperCase();
                if (!nextLine.includes('DATE') && !nextLine.includes('#')) {
                    company = lines[invoiceIndex + 1];
                    if (invoiceIndex + 2 < lines.length) address.push(lines[invoiceIndex + 2]);
                }
            }

            // 3. Customer Name (Buyer)
            // The user defined "customer name is below the buyer just before phone number"
            if (validPhones.length > 0) {
                // The Buyer's phone is typically the last phone on the invoice
                const buyerPhone = validPhones[validPhones.length - 1];
                for (let j = invoicesIndex = 0; j < lines.length; j++) {
                    if (lines[j].includes(buyerPhone)) {
                        const idx = lines[j].indexOf(buyerPhone);
                        if (idx > 0) {
                            const textBeforePhone = lines[j].substring(0, idx).trim();
                            const words = textBeforePhone.split(/\s+/);
                            // Get the word immediately preceding the phone number
                            if (words.length > 0) {
                                customerName = words[words.length - 1];
                            }
                        } else if (j > 0) {
                            // If phone is at the start of the line, buyer might be on the previous line
                            customerName = lines[j - 1].split(/\s+/).pop();
                        }
                        break;
                    }
                }
            }

            // Fallback for Customer Name if perfectly separated next to "BUYER"
            if (!customerName) {
                for (let j = 0; j < lines.length; j++) {
                    const upLine = lines[j].toUpperCase();
                    if (upLine.includes('BUYER')) {
                        if (j + 1 < lines.length) {
                            const nextWords = lines[j + 1].trim().split(/\s+/);
                            // Usually the Buyer name is the 2nd to last word if Phone is last, 
                            // but if no phone was matched, just guess the last word
                            customerName = nextWords[nextWords.length - 1];
                        }
                        break;
                    }
                }
            }
        }

        return {
            phone: phoneNumbers,
            company: company.trim(),
            address: address.join(' '),
            customerName: customerName.trim()
        };
    }

    // Extract Text using Tesseract
    extractBtn.addEventListener('click', async () => {
        if (!currentFile) return;

        extractBtn.disabled = true;
        resultsContainer.style.display = 'none';
        loader.style.display = 'flex';
        saveBtn.disabled = true;
        showStatus('Enhancing image and running OCR...', '');

        try {
            // Preprocess Image for better OCR
            const processedImageDataUrl = await preprocessImage(currentFile);

            const result = await Tesseract.recognize(
                processedImageDataUrl,
                'eng',
                { logger: m => console.log(m) }
            );

            const rawText = result.data.text;

            // Parse for specific fields
            const parsedData = parseInvoiceData(rawText);

            resultTextarea.value = rawText;
            parsedCompany.value = parsedData.company;
            parsedCustomerName.value = parsedData.customerName;
            parsedPhone.value = parsedData.phone;
            parsedAddress.value = parsedData.address;

            resultsContainer.style.display = 'block';
            saveBtn.disabled = false;
            showStatus('OCR extraction successful.', 'success');
        } catch (error) {
            console.error(error);
            showStatus('OCR failed: ' + error.message, 'error');
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
