import { FileText, Sparkles } from "lucide-react";
import React, { useState } from "react";
import axios from "axios";
import { useAuth } from "@clerk/clerk-react";
import toast from "react-hot-toast";
import Markdown from "react-markdown";

axios.defaults.baseURL = import.meta.env.VITE_BASE_URL;

const ReviewResume = () => {
  const [input, setInput] = useState(null);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState("");

  const { getToken } = useAuth();

  const onSubmitHandler = async (e) => {
    e.preventDefault();

    if (loading) return;

    if (!input) {
      toast.error("Please upload a resume PDF");
      return;
    }

    if (input.type !== "application/pdf") {
      toast.error("Only PDF files are allowed");
      return;
    }

    try {
      setLoading(true);
      setContent("");

      const formData = new FormData();
      formData.append("resume", input);

      const token = await getToken();

      const { data } = await axios.post("/api/ai/resume-review", formData, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (data.success) {
        setContent(data.content);
        toast.success("Resume reviewed successfully");
      } else {
        toast.error(data.message || "Failed to review resume");
      }
    } catch (error) {
      toast.error(
        error?.response?.data?.message ||
          error.message ||
          "Something went wrong",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 flex items-start flex-wrap gap-4 text-slate-700">
      <form
        onSubmit={onSubmitHandler}
        className="w-full max-w-lg p-5 bg-white rounded-xl border border-gray-200 shadow-sm"
      >
        <div className="flex items-center gap-3">
          <Sparkles className="w-6 text-[#00DA83]" />
          <h1 className="text-2xl font-semibold">Resume Review</h1>
        </div>

        <p className="mt-6 text-sm font-medium text-slate-700">Upload Resume</p>

        <input
          onChange={(e) => setInput(e.target.files?.[0] || null)}
          type="file"
          accept="application/pdf"
          className="w-full p-3 mt-2 outline-none text-sm rounded-lg border border-gray-300 text-gray-600 bg-white"
          required
        />

        <p className="text-xs text-gray-500 font-light mt-2">
          Supports PDF resume only.
        </p>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center items-center gap-2 bg-gradient-to-r from-[#00DA83] to-[#009BB3] text-white px-4 py-3 mt-6 text-sm rounded-lg cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 my-1 rounded-full border-2 border-white border-t-transparent animate-spin"></span>
              Reviewing Resume...
            </>
          ) : (
            <>
              <FileText className="w-5" />
              Review Resume
            </>
          )}
        </button>
      </form>

      <div className="w-full max-w-2xl p-5 bg-white rounded-xl flex flex-col border border-gray-200 shadow-sm min-h-[500px] max-h-[650px]">
        <div className="flex items-center gap-3 border-b border-gray-200 pb-3">
          <FileText className="w-5 h-5 text-[#00DA83]" />
          <h1 className="text-2xl font-semibold">Analysis Results</h1>
        </div>

        {!content ? (
          <div className="flex-1 flex justify-center items-center">
            <div className="text-sm flex flex-col items-center gap-4 text-gray-400 text-center">
              <FileText className="w-10 h-10" />
              <p>Upload a resume and click "Review Resume" to get started</p>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex-1 overflow-y-auto pr-2">
            <Markdown
              components={{
                h1: ({ children }) => (
                  <h1 className="text-2xl font-bold text-slate-800 mb-4 border-b border-gray-200 pb-2">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-bold text-slate-800 mt-5 mb-2">
                    {children}
                  </h2>
                ),
                p: ({ children }) => (
                  <p className="text-sm leading-7 text-slate-700 mb-3">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="mb-3 space-y-1">{children}</ul>
                ),
                li: ({ children }) => (
                  <li className="text-sm leading-7 text-slate-700 ml-5 list-disc">
                    {children}
                  </li>
                ),
                strong: ({ children }) => (
                  <strong className="font-bold text-slate-900">
                    {children}
                  </strong>
                ),
              }}
            >
              {content}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  );
};

export default ReviewResume;
