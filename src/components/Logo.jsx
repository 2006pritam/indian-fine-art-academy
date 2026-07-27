import React from 'react'
import logo from '/logo.jpg'

/**
 * Academy logo — the official seal photo, cropped to a clean circle.
 */
export default function Logo({ size = 96, className = '' }) {
  return (
    <img
      src={logo}
      alt="The Indian Music & Fine Arts Academy, West Bengal"
      className={`logo-img ${className}`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
    />
  )
}
