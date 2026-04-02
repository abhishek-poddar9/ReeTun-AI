import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import pdf from "pdf-parse/lib/pdf-parse.js";

const AI = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const countWords = (text = "") =>
  String(text).trim().split(/\s+/).filter(Boolean).length;

const looksIncomplete = (text = "") => {
  const value = String(text || "").trim();

  if (!value) return true;

  const endsWell = /[.!?)"\]]$/.test(value);
  const hasEnoughLength = value.length > 300;

  return !(endsWell && hasEnoughLength);
};

const extractTitles = (rawText = "") => {
  let text = String(rawText || "").replace(/\r/g, "").trim();

  text = text
    .replace(/^here are.*?:/i, "")
    .replace(/^sure.*?:/i, "")
    .replace(/^certainly.*?:/i, "")
    .trim();

  let parts = text
    .split(/\n|;|\|/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) =>
      item
        .replace(/^[-*•]\s*/, "")
        .replace(/^\d+[\.\)]\s*/, "")
        .trim()
    )
    .filter(Boolean);

  const unique = [...new Set(parts)].filter(
    (item) =>
      item.length > 8 &&
      !/^here are/i.test(item) &&
      !/^these are/i.test(item)
  );

  return unique.slice(0, 10);
};

const hasResumeSections = (text = "") => {
  const value = String(text || "").toLowerCase();

  return (
    value.includes("overall ats score") &&
    value.includes("strengths") &&
    value.includes("weaknesses") &&
    value.includes("suggestions for improvement") &&
    value.includes("final verdict")
  );
};



const continueIfNeeded = async ({
  originalContent,
  topic,
  type,
  extraInstruction = "",
  maxTokens = 1200,
}) => {
  const content = String(originalContent || "").trim();

  if (!looksIncomplete(content)) {
    return content;
  }

  const continuationPrompt = `
The following ${type} response looks incomplete and cut off.

Topic: "${topic}"

Continue naturally from where it ended.
Do not restart from the beginning.
Do not repeat previous lines.
Complete the response properly.
${extraInstruction}

Existing content:
${content}
`;

  const continuation = await callGemini({
    prompt: continuationPrompt,
    temperature: 0.6,
    maxTokens,
  });

  return `${content}\n${continuation}`.trim();
};

const handleAiError = (res, error, featureName = "AI Request") => {
  console.log(`${featureName} ERROR FULL:`, error);
  console.log(`${featureName} ERROR MESSAGE:`, error?.message);
  console.log(
    `${featureName} ERROR STATUS:`,
    error?.status || error?.response?.status
  );
  console.log(`${featureName} ERROR DATA:`, error?.response?.data);

  const statusCode = error?.status || error?.response?.status;

  if (statusCode === 429) {
    return res.status(429).json({
      success: false,
      message: "Gemini API rate limit or quota exceeded. Please try again later.",
    });
  }

  if (statusCode === 404) {
    return res.status(404).json({
      success: false,
      message: "Requested Gemini model was not found.",
    });
  }

  return res.status(500).json({
    success: false,
    message: error?.message || "Something went wrong while processing request.",
  });
};

const callGemini = async ({
  prompt,
  temperature = 0.7,
  maxTokens = 1200,
}) => {
  const response = await AI.chat.completions.create({
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: prompt }],
    temperature,
    max_tokens: maxTokens,
  });

  return response?.choices?.[0]?.message?.content?.trim() || "";
};

const normalizeLength = (length = "") => {
  const value = String(length).toLowerCase().trim();

  if (value.includes("short")) return "short";
  if (value.includes("medium")) return "medium";
  if (value.includes("long")) return "long";

  return "short";
};

export const testGemini = async (req, res) => {
  try {
    const content = await callGemini({
      prompt: "Say hello in one short line.",
      temperature: 0.2,
      maxTokens: 40,
    });

    return res.json({ success: true, content });
  } catch (error) {
    return handleAiError(res, error, "Test Gemini");
  }
};

export const generateArticle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, length } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (!prompt || !String(prompt).trim()) {
      return res.json({
        success: false,
        message: "Article topic is required.",
      });
    }

    if (plan !== "premium" && free_usage >= 10) {
      return res.json({
        success: false,
        message: "Limit reached. Upgrade to continue.",
      });
    }

    const topic = String(prompt).replace(/^about\s+/i, "").trim();
    const normalizedLength = normalizeLength(length);

    let words = "500 to 800 words";
    let minWords = 500;
    let maxTokens = 2200;

    if (normalizedLength === "medium") {
      words = "800 to 1200 words";
      minWords = 800;
      maxTokens = 3200;
    } else if (normalizedLength === "long") {
      words = "1200 to 1500 words";
      minWords = 1200;
      maxTokens = 4200;
    }

    const finalPrompt = `
Write a complete, detailed, and well-structured article on the topic "${topic}".

Strict instructions:
- Article length must be ${words}.
- Focus only on the topic "${topic}".
- Start with a proper title.
- Then write an introduction.
- Then write the main body with clear headings and meaningful paragraphs.
- End with a proper conclusion.
- Do not stop midway.
- Do not return notes or explanation outside the article.
- Return only the final complete article.
- Minimum target length: ${minWords} words.
`;

    let content = await callGemini({
      prompt: finalPrompt,
      temperature: 0.7,
      maxTokens,
    });

    const wordCount = countWords(content);

    if (wordCount < minWords || looksIncomplete(content)) {
      content = await continueIfNeeded({
        originalContent: content,
        topic,
        type: "article",
        extraInstruction: `Make sure the final article is fully complete and at least close to ${words}. End with a proper conclusion.`,
        maxTokens: 1800,
      });
    }

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${topic}, ${content}, 'article')
    `;

    if (plan !== "premium") {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1,
        },
      });
    }

    res.json({
      success: true,
      content,
    });
  } catch (error) {
    return handleAiError(res, error, "Generate Article");
  }
};

export const generateBlogTitle = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, category } = req.body;
    const plan = req.plan;
    const free_usage = req.free_usage;

    if (!prompt || !String(prompt).trim()) {
      return res.json({
        success: false,
        message: "Keyword is required.",
      });
    }

    if (plan !== "premium" && free_usage >= 10) {
      return res.json({
        success: false,
        message: "Limit reached. Upgrade to continue.",
      });
    }

    const topic = String(prompt).trim();
    const selectedCategory = String(category || "General").trim();

    const finalPrompt = `
Generate exactly 10 meaningful, catchy, and natural blog titles.

Topic: "${topic}"
Category: "${selectedCategory}"

Strict rules:
- Return exactly 10 titles.
- Each title must be on a separate new line.
- Do not add any introduction.
- Do not add explanations.
- Do not add numbering.
- Do not add bullet points.
- Only return titles.
`;

    let rawContent = await callGemini({
      prompt: finalPrompt,
      temperature: 0.9,
      maxTokens: 700,
    });

    let titles = extractTitles(rawContent);

    if (titles.length < 10) {
      const retryPrompt = `
Generate ${10 - titles.length} more blog titles for the same topic.

Topic: "${topic}"
Category: "${selectedCategory}"

Already generated titles:
${titles.join("\n")}

Rules:
- Return only new titles.
- Do not repeat old titles.
- Do not add introduction.
- Each title must be on a new line.
`;

      const extraContent = await callGemini({
        prompt: retryPrompt,
        temperature: 0.9,
        maxTokens: 400,
      });

      titles = [...titles, ...extractTitles(extraContent)];
    }

    const uniqueTitles = [...new Set(titles)].slice(0, 10);
    const content = uniqueTitles
      .map((title, index) => `${index + 1}. ${title}`)
      .join("\n");

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${topic}, ${content}, 'blog-title')
    `;

    if (plan !== "premium") {
      await clerkClient.users.updateUserMetadata(userId, {
        privateMetadata: {
          free_usage: free_usage + 1,
        },
      });
    }

    res.json({ success: true, content });
  } catch (error) {
    return handleAiError(res, error, "Generate Blog Title");
  }
};

export const generateImage = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { prompt, publish } = req.body;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    const formData = new FormData();
    formData.append("prompt", prompt);

    const { data } = await axios.post(
      "https://clipdrop-api.co/text-to-image/v1",
      formData,
      {
        headers: { "x-api-key": process.env.CLIPDROP_API_KEY },
        responseType: "arraybuffer",
      }
    );

    const base64Image = `data:image/png;base64,${Buffer.from(
      data,
      "binary"
    ).toString("base64")}`;

    const { secure_url } = await cloudinary.uploader.upload(base64Image);

    await sql`
      INSERT INTO creations (user_id, prompt, content, type, publish)
      VALUES (${userId}, ${prompt}, ${secure_url}, 'image', ${publish ?? false})
    `;

    res.json({ success: true, content: secure_url });
  } catch (error) {
    console.log("Generate Image ERROR:", error?.message || error);
    res.json({
      success: false,
      message: error?.message || "Image generation failed.",
    });
  }
};

export const removeImageBackground = async (req, res) => {
  try {
    const { userId } = req.auth();
    const image = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    const { secure_url } = await cloudinary.uploader.upload(image.path, {
      transformation: [
        {
          effect: "background_removal",
          background_removal: "remove_the_background",
        },
      ],
    });

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, 'Remove background from image', ${secure_url}, 'image')
    `;

    res.json({ success: true, content: secure_url });
  } catch (error) {
    console.log("Remove Background ERROR:", error?.message || error);
    res.json({
      success: false,
      message: error?.message || "Background removal failed.",
    });
  }
};

export const removeImageObject = async (req, res) => {
  try {
    const { userId } = req.auth();
    const { object } = req.body;
    const image = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    const { public_id } = await cloudinary.uploader.upload(image.path);

    const imageUrl = cloudinary.url(public_id, {
      transformation: [{ effect: `gen_remove:${object}` }],
      resource_type: "image",
    });

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')
    `;

    res.json({ success: true, content: imageUrl });
  } catch (error) {
    console.log("Remove Object ERROR:", error?.message || error);
    res.json({
      success: false,
      message: error?.message || "Object removal failed.",
    });
  }
};

export const resumeReview = async (req, res) => {
  try {
    const { userId } = req.auth();
    const resume = req.file;
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is only available for premium subscriptions",
      });
    }

    if (!resume) {
      return res.json({
        success: false,
        message: "Resume file is required.",
      });
    }

    if (resume.size > 5 * 1024 * 1024) {
      return res.json({
        success: false,
        message: "Resume file size exceeds allowed size (5MB).",
      });
    }

    const dataBuffer = fs.readFileSync(resume.path);
    const pdfData = await pdf(dataBuffer);
    const resumeText = String(pdfData.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 7000);

    const finalPrompt = `
You are an expert ATS resume reviewer.

Review this resume and return a COMPLETE and properly structured result.

Resume text:
${resumeText}

Return in exactly this structure:

# Resume Review

## Overall ATS Score
Give a score out of 100 and one short reason.

## Strengths
Give 4 bullet points.

## Weaknesses
Give 4 bullet points.

## Suggestions for Improvement
Give 6 bullet points.

## Missing Keywords / ATS Improvements
Give 5 bullet points.

## Final Verdict
Write 3 to 4 lines.

Strict rules:
- Do not skip any section.
- Do not stop midway.
- Do not write random intro text.
- Return only the final review.
`;

    let content = await callGemini({
      prompt: finalPrompt,
      temperature: 0.4,
      maxTokens: 2200,
    });

    if (!hasResumeSections(content) || looksIncomplete(content)) {
      content = await continueIfNeeded({
        originalContent: content,
        topic: "resume review",
        type: "resume review",
        extraInstruction:
          "Complete all missing sections properly, especially Overall ATS Score, Strengths, Weaknesses, Suggestions for Improvement, Missing Keywords / ATS Improvements, and Final Verdict.",
        maxTokens: 1200,
      });
    }

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, 'Review the uploaded resume', ${content}, 'resume-review')
    `;

    res.json({ success: true, content });
  } catch (error) {
    return handleAiError(res, error, "Resume Review");
  }
};