import React from 'react'
import { assets } from '../assets/assets'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import {useClerk, UserButton, useUser} from '@clerk/clerk-react'
import logo from "../assets/Image.png";

const Navbar = () => {

    const navigate = useNavigate()
    const {user} = useUser()
    const { openSignIn } = useClerk()


  return (
    <div className='fixed z-5 w-full backdrop-blur-2xl flex justify-between items-center py-3 px-4 sm:px-20 xl:px-32'>
     <div className='flex items-center gap-2 cursor-pointer' onClick={() => navigate('/')}>
                <img src={logo} alt="logo" className='h-10 object-contain' />
                <span className='text-xl font-bold bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent'>
  ReeTun AI
</span>
            </div>
      {
        user ? <UserButton /> 
        : 
        (
          <button onClick={openSignIn} className='flex items-center gap-2 rounded-full text-sm cursor-pointer bg-primary text-white px-10 py-2.5'>Get started <ArrowRight className='w-4 h-4'/> </button>
        )
      }

      
    </div>
  )
}

export default Navbar
