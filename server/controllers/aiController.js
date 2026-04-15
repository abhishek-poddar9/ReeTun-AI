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
  if (value.length < 700) return true;

  const endsWell = /[.!?)"\]]$/.test(value);
  const hasTooManyDots = /\.\.\./.test(value);
  const hasCutEnding =
    /(strengths|weaknesses|suggestions|final verdict|missing keywords|summary)\s*:?$/i.test(
      value
    );

  return !endsWell || hasTooManyDots || hasCutEnding;
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

const getBulletCount = (sectionText = "") => {
  return String(sectionText)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*•]\s+/.test(line)).length;
};

const extractSection = (text = "", heading = "") => {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const regex = new RegExp(
    `##\\s*${escapedHeading}\\s*([\\s\\S]*?)(?=\\n##\\s|$)`,
    "i"
  );

  const match = String(text).match(regex);
  return match ? match[1].trim() : "";
};

const hasResumeSections = (text = "") => {
  const value = String(text || "");

  const requiredHeadings = [
    "## Overall ATS Score",
    "## Summary",
    "## Strengths",
    "## Weaknesses",
    "## Suggestions for Improvement",
    "## Missing Keywords / ATS Improvements",
    "## Final Verdict",
  ];

  const allHeadingsExist = requiredHeadings.every((heading) =>
    value.toLowerCase().includes(heading.toLowerCase())
  );

  if (!allHeadingsExist) return false;

  const strengths = extractSection(value, "Strengths");
  const weaknesses = extractSection(value, "Weaknesses");
  const suggestions = extractSection(value, "Suggestions for Improvement");
  const keywords = extractSection(value, "Missing Keywords / ATS Improvements");
  const verdict = extractSection(value, "Final Verdict");
  const summary = extractSection(value, "Summary");
  const score = extractSection(value, "Overall ATS Score");

  if (!score || !summary || !verdict) return false;
  if (getBulletCount(strengths) < 4) return false;
  if (getBulletCount(weaknesses) < 4) return false;
  if (getBulletCount(suggestions) < 6) return false;
  if (getBulletCount(keywords) < 5) return false;

  return true;
};

const buildResumePrompt = (resumeText) => `
You are an expert ATS Resume Reviewer and technical hiring evaluator.

Carefully analyze the following resume text and return a COMPLETE, PROFESSIONAL, and WELL-STRUCTURED review in VALID MARKDOWN format.

Resume text:
"""
${resumeText}
"""

You MUST return the response in EXACTLY this structure:

# Resume Review

## Overall ATS Score
Give:
- ATS score in this format: **78/100**
- Then 2 to 3 lines explaining why this score was given

## Summary
Write 3 to 4 professional lines summarizing the overall resume quality, ATS readability, keyword strength, and recruiter impression.

## Strengths
Give EXACTLY 4 bullet points.
Each bullet must start with "- ".

## Weaknesses
Give EXACTLY 4 bullet points.
Each bullet must start with "- ".

## Suggestions for Improvement
Give EXACTLY 6 bullet points.
Each bullet must start with "- ".

## Missing Keywords / ATS Improvements
Give EXACTLY 5 bullet points.
Each bullet must start with "- ".

## Final Verdict
Write 4 to 5 lines giving the final overall judgment.

Strict rules:
- Do not skip any section
- Do not stop midway
- Do not write any introduction before "# Resume Review"
- Do not write any extra section apart from the required sections
- Do not use tables
- Do not use numbering
- Every required bullet point must be complete and meaningful
- Response must be complete and polished
- Do not output placeholder text
- Do not repeat the same point
`;

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

  const content = response?.choices?.[0]?.message?.content;

  if (Array.isArray(content)) {
    return content.map((item) => item?.text || "").join("").trim();
  }

  return String(content || "").trim();
};

const generateResumeReviewContent = async (resumeText) => {
  let bestContent = "";

  for (let attempt = 1; attempt <= 3; attempt++) {
    const prompt =
      attempt === 1
        ? buildResumePrompt(resumeText)
        : `
The previous response was incomplete or did not follow the required structure.

Please regenerate the ENTIRE response from scratch.

${buildResumePrompt(resumeText)}
`;

    const content = await callGemini({
      prompt,
      temperature: 0.3,
      maxTokens: 3000,
    });

    if (content && content.length > bestContent.length) {
      bestContent = content;
    }

    if (hasResumeSections(content) && !looksIncomplete(content)) {
      return content.trim();
    }
  }

  return bestContent.trim();
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

    return res.json({
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

    return res.json({ success: true, content });
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

    return res.json({ success: true, content: secure_url });
  } catch (error) {
    console.log("Generate Image ERROR:", error?.message || error);
    return res.json({
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

    return res.json({ success: true, content: secure_url });
  } catch (error) {
    console.log("Remove Background ERROR:", error?.message || error);
    return res.json({
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

    return res.json({ success: true, content: imageUrl });
  } catch (error) {
    console.log("Remove Object ERROR:", error?.message || error);
    return res.json({
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
      .replace(/\r/g, " ")
      .replace(/\n+/g, "\n")
      .replace(/[ \t]+/g, " ")
      .trim()
      .slice(0, 12000);

    if (!resumeText || resumeText.length < 100) {
      return res.json({
        success: false,
        message: "Could not extract enough text from the uploaded PDF resume.",
      });
    }

    const content = await generateResumeReviewContent(resumeText);

    if (!content || !hasResumeSections(content)) {
      return res.json({
        success: false,
        message:
          "Could not generate a proper structured resume review. Please try again.",
      });
    }

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, 'Review the uploaded resume', ${content}, 'resume-review')
    `;

    try {
      if (resume.path && fs.existsSync(resume.path)) {
        fs.unlinkSync(resume.path);
      }
    } catch (cleanupError) {
      console.log("Resume file cleanup error:", cleanupError?.message);
    }

    return res.json({
      success: true,
      content,
    });
  } catch (error) {
    try {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
    } catch (cleanupError) {
      console.log("Resume file cleanup error:", cleanupError?.message);
    }

    return handleAiError(res, error, "Resume Review");
  }
};