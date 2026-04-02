import { Edit, Sparkles } from 'lucide-react'
import React, { useState } from 'react'
import axios from 'axios'
import { useAuth } from '@clerk/clerk-react'
import toast from 'react-hot-toast'
import Markdown from 'react-markdown'

axios.defaults.baseURL = import.meta.env.VITE_BASE_URL

const WriteArticle = () => {
  const articleLength = [
    { key: 'short', text: 'Short (500-800 words)' },
    { key: 'medium', text: 'Medium (800-1200 words)' },
    { key: 'long', text: 'Long (1200+ words)' },
  ]

  const [selectedLength, setSelectedLength] = useState(articleLength[0])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [content, setContent] = useState('')

  const { getToken } = useAuth()

  const onSubmitHandler = async (e) => {
    e.preventDefault()

    if (loading) return

    if (!input.trim()) {
      toast.error('Please enter an article topic')
      return
    }

    try {
      setLoading(true)
      setContent('')

      const token = await getToken()

      const { data } = await axios.post(
        '/api/ai/generate-article',
        {
          prompt: input.trim(),
          length: selectedLength.key,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      )

      if (data.success) {
        setContent(data.content)
      } else {
        toast.error(data.message || 'Failed to generate article')
      }
    } catch (error) {
      toast.error(
        error?.response?.data?.message || error.message || 'Something went wrong'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='h-full overflow-y-scroll p-6 flex items-start flex-wrap gap-4 text-slate-700'>
      <form
        onSubmit={onSubmitHandler}
        className='w-full max-w-lg p-4 bg-white rounded-lg border border-gray-200'
      >
        <div className='flex items-center gap-3'>
          <Sparkles className='w-6 text-[#4A7AFF]' />
          <h1 className='text-xl font-semibold'>Article Configuration</h1>
        </div>

        <p className='mt-6 text-sm font-medium'>Article Topic</p>

        <input
          onChange={(e) => setInput(e.target.value)}
          value={input}
          type='text'
          className='w-full p-2 px-3 mt-2 outline-none text-sm rounded-md border border-gray-300'
          placeholder='Enter article topic'
          required
        />

        <p className='mt-4 text-sm font-medium'>Article Length</p>

        <div className='mt-3 flex gap-3 flex-wrap sm:max-w-9/11'>
          {articleLength.map((item) => (
            <span
              onClick={() => !loading && setSelectedLength(item)}
              className={`text-xs px-4 py-1 border rounded-full cursor-pointer ${
                selectedLength.key === item.key
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                  : 'text-gray-500 border-gray-300'
              }`}
              key={item.key}
            >
              {item.text}
            </span>
          ))}
        </div>

        <br />

        <button
          type='submit'
          disabled={loading}
          className='w-full flex justify-center items-center gap-2 bg-gradient-to-r from-[#226BFF] to-[#65ADFF] text-white px-4 py-2 mt-6 text-sm rounded-lg cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed'
        >
          {loading ? (
            <span className='w-4 h-4 my-1 rounded-full border-2 border-t-transparent animate-spin'></span>
          ) : (
            <Edit className='w-5' />
          )}
          Generate article
        </button>
      </form>

      <div className='w-full max-w-lg p-4 bg-white rounded-lg flex flex-col border border-gray-200 min-h-96 max-h-[600px]'>
        <div className='flex items-center gap-3'>
          <Edit className='w-5 h-5 text-[#4A7AFF]' />
          <h1 className='text-xl font-semibold'>Generated article</h1>
        </div>

        {!content ? (
          <div className='flex-1 flex justify-center items-center'>
            <div className='text-sm flex flex-col items-center gap-5 text-gray-400'>
              <Edit className='w-9 h-9' />
              <p>Enter a topic and click “Generate article” to get started</p>
            </div>
          </div>
        ) : (
          <div className='mt-3 h-full overflow-y-scroll text-sm text-slate-600'>
            <div className='reset-tw prose prose-sm max-w-none'>
              <Markdown>{content}</Markdown>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WriteArticle