// server.js
// Medication verification backend using Groq + Qwen 3.6 27B Vision

const express = require('express');
const cors = require('cors');
require('dotenv').config();

const Groq = require('groq-sdk');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GROQ_API_KEY = process.env.GROQ_API_KEY;

if (!GROQ_API_KEY) {
  console.error('❌ GROQ_API_KEY is missing from .env');
  process.exit(1);
}

const groq = new Groq({
  apiKey: GROQ_API_KEY,
});

app.post('/verify-medication', async (req, res) => {
  const { imageBase64, expectedDrug } = req.body;

  if (!imageBase64 || !expectedDrug) {
    return res.status(400).json({
      error: 'imageBase64 and expectedDrug are both required.',
    });
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'qwen/qwen3.6-27b',

      messages: [
        {
          role: 'system',
          content: `
You are a medication packaging verification assistant.

Your job is to carefully inspect the medication package image.

IMPORTANT:
- Read the actual text printed on the package.
- Do not guess a medication name when the text is unclear.
- Pay special attention to the medicine name, strength, dosage form,
  and expiry date.
- If the expiry date cannot be clearly read, return "not visible".
- If the medication name cannot be clearly read, return "unclear".
- The expected medication name is provided separately.
- Only mark match as true when the detected medication clearly matches
  the expected medication.
- Do not use general visual similarity as proof of a medication match.
- Respond with ONLY a raw JSON object, no markdown code fences, no
  extra commentary before or after it.
          `,
        },

        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `
Inspect this medication package.

Expected medication:
"${expectedDrug}"

Return ONLY valid JSON using exactly this structure:

{
  "detectedDrug": "string",
  "match": true,
  "expiryDate": "string",
  "expiryStatus": "OK",
  "info": "string"
}

Rules:

detectedDrug:
The medication name actually printed on the package.
Use "unclear" if you cannot confidently read it.

match:
true only if detectedDrug clearly matches "${expectedDrug}".
Otherwise false.

expiryDate:
The expiry date printed on the package.
Use "not visible" if you cannot clearly see it.

expiryStatus:
Use exactly one of:
"OK"
"EXPIRED"
"UNKNOWN"

Use UNKNOWN when the expiry date cannot be confidently determined.

info:
One short sentence describing what this medication is generally used for.

Do not invent information that cannot be read or verified from the image.
              `,
            },

            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],

      // NOTE: strict JSON mode (response_format: json_object) was removed —
      // on Groq, that mode combined with image input was causing a
      // 400 "json_validate_failed" error for this model. We instead rely
      // on the prompt itself to enforce JSON output, and parse leniently
      // below (stripping markdown fences if the model adds them anyway).
      temperature: 0,
      max_completion_tokens: 500,
    });

    const rawText =
      completion?.choices?.[0]?.message?.content || '{}';

    console.log('--- RAW GROQ RESPONSE ---');
    console.log(rawText);
    console.log('-------------------------');

    // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    const cleanedText = rawText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    let result;

    try {
      result = JSON.parse(cleanedText);
    } catch (parseError) {
      console.error('Failed to parse model JSON:', parseError);
      console.error('Cleaned text was:', cleanedText);

      return res.status(500).json({
        error: 'The AI returned an invalid response.',
      });
    }

    const detectedDrug =
      typeof result.detectedDrug === 'string'
        ? result.detectedDrug.trim()
        : 'Unclear';

    const match = result.match === true;

    const expiryDate =
      typeof result.expiryDate === 'string'
        ? result.expiryDate.trim()
        : 'Not visible';

    const allowedExpiryStatuses = ['OK', 'EXPIRED', 'UNKNOWN'];

    const expiryStatus = allowedExpiryStatuses.includes(
      String(result.expiryStatus).toUpperCase()
    )
      ? String(result.expiryStatus).toUpperCase()
      : 'UNKNOWN';

    const info =
      typeof result.info === 'string'
        ? result.info.trim()
        : '';

    res.json({
      match,
      detectedDrug,
      expiryDate,
      expiryStatus,
      info,
    });

  } catch (error) {
    console.error('Groq verification failed:', error);

    res.status(500).json({
      error: 'Verification failed. Please try again.',
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    model: 'qwen/qwen3.6-27b',
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(
    `Medication verification server running on port ${PORT}`
  );
});