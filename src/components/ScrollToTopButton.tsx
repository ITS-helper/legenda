import { useEffect, useState } from 'react'

const SCROLL_THRESHOLD = 320

export function ScrollToTopButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > SCROLL_THRESHOLD)
    }

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <button
      type="button"
      className={`scroll-to-top${visible ? ' scroll-to-top-visible' : ''}`}
      onClick={scrollToTop}
      aria-label="Наверх страницы"
      title="Наверх"
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path
          d="M12 6.5 6 12.5l1.4 1.4L11 10.3V17h2v-6.7l3.6 3.6L18 12.5 12 6.5Z"
          fill="currentColor"
        />
      </svg>
    </button>
  )
}
