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
  "info": "string"
}

Rules:

detectedDrug:
The medication name actually printed on the package.
Use "unclear" if you cannot confidently read it.

match:
true only if detectedDrug clearly matches "${expectedDrug}".
Otherwise false.

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
      // below (stripping the model's <think> reasoning block and any
      // markdown fences before parsing).
      temperature: 0,
      max_completion_tokens: 1500,
    });

    const rawText =
      completion?.choices?.[0]?.message?.content || '{}';

    console.log('--- RAW GROQ RESPONSE ---');
    console.log(rawText);
    console.log('-------------------------');

    // Strip the model's <think>...</think> reasoning block, if present —
    // only the JSON after it is the actual answer.
    let cleanedText = rawText;
    const thinkEndIndex = cleanedText.indexOf('</think>');
    if (thinkEndIndex !== -1) {
      cleanedText = cleanedText.slice(thinkEndIndex + '</think>'.length);
    }

    // Strip markdown code fences if present (```json ... ``` or ``` ... ```)
    cleanedText = cleanedText
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    // As a last resort, if there's still stray text around the JSON,
    // extract just the first {...} block.
    if (!cleanedText.startsWith('{')) {
      const jsonMatch = cleanedText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        cleanedText = jsonMatch[0];
      }
    }

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

    const info =
      typeof result.info === 'string'
        ? result.info.trim()
        : '';

    res.json({
      match,
      detectedDrug,
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