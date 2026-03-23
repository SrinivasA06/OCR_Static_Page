export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        const { image } = req.body;
        
        // Vercel Environment Variable Protection
        if (!process.env.OPENAI_API_KEY) {
            return res.status(500).json({ error: "Configuration Error: OPENAI_API_KEY is missing from Vercel Environment Variables." });
        }

        if (!image) {
            return res.status(400).json({ error: "Missing image payload." });
        }

        const systemPrompt = `You are an expert OCR data extraction assistant. Parse the visual text and layout within this invoice image and extract the exact fields below:
- company: The name of the client company being billed (often found under "BILL TO"). Do NOT return the invoice sender.
- customerName: The name of the specific buyer or employee (often located under "BUYER" or near the phone number).
- phone: The buyer's phone number.
- address: The full physical address of the client company.

Rules:
- If a field is not found or ambiguous, leave its value as an empty string.
- Return ONLY a raw JSON object string with the exactly matched keys: "company", "customerName", "phone", "address".`;

        // Safely Execute the Server-to-Server Request
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { 
                        role: 'user', 
                        content: [
                            { type: "text", text: "Parse this invoice image and precisely deliver the required data:" },
                            { type: "image_url", image_url: { url: image } }
                        ] 
                    }
                ],
                max_tokens: 300,
                temperature: 0.0
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            return res.status(response.status).json({ error: errData.error?.message || "OpenAI API Call Failed" });
        }

        const data = await response.json();
        let content = data.choices[0].message.content.trim();
        
        // Strip markdown blocks if GPT incorrectly wraps it
        if (content.startsWith('```json')) content = content.substring(7);
        if (content.endsWith('```')) content = content.substring(0, content.length - 3);
        
        return res.status(200).json({ parsedData: JSON.parse(content.trim()) });

    } catch (error) {
        console.error("Vercel Function Proxy Error:", error);
        return res.status(500).json({ error: "Internal Serverless Execution Error: " + error.message });
    }
}
