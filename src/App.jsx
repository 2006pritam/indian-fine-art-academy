import React, { useState, useEffect } from 'react'
import Logo from './components/Logo.jsx'
import Admission, { PublicRegister } from './components/Admission.jsx'

const NAV = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'courses', label: 'Courses' },
  { id: 'gallery', label: 'Gallery' },
  { id: 'board', label: 'Recognition' },
  { id: 'contact', label: 'Contact' },
]

const COURSES = [
  {
    level: 'Sub Junior',
    desc: 'Foundation drawing for young beginners — lines, shapes, colours and imagination.',
    icon: '✏️',
  },
  {
    level: 'Junior',
    desc: 'Building sketching skills, still life, nature study and basic composition.',
    icon: '🖌️',
  },
  {
    level: 'Senior Diploma',
    desc: 'Advanced drawing, shading, perspective and portrait techniques.',
    icon: '🎨',
  },
  {
    level: 'Bisharad',
    desc: 'Higher fine-art specialisation with figure study and creative painting.',
    icon: '🏛️',
  },
  {
    level: 'Ratna',
    desc: 'The highest honour — mastery of fine art with an independent portfolio.',
    icon: '🏆',
  },
]

const GALLERY = [
  { src: 'https://images.unsplash.com/photo-1503454537195-1dcabb73ffb9?auto=format&fit=crop&w=800&q=70', alt: 'Student painting on canvas' },
  { src: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=800&q=70', alt: 'Colourful artwork' },
  { src: 'https://images.unsplash.com/photo-1499892477393-f675706cbfac?auto=format&fit=crop&w=800&q=70', alt: 'Child drawing with crayons' },
  { src: 'https://images.unsplash.com/photo-1452860606245-08befc0ff44b?auto=format&fit=crop&w=800&q=70', alt: 'Art supplies and brushes' },
  { src: 'https://images.unsplash.com/photo-1596464716127-f2a82984de30?auto=format&fit=crop&w=800&q=70', alt: 'Young artist sketching' },
  { src: 'https://images.unsplash.com/photo-1560421683-6856ea585c78?auto=format&fit=crop&w=800&q=70', alt: 'Watercolour painting session' },
]

const STUDENTS = [
  {
    name: 'Ananya Das',
    course: 'Senior Diploma',
    img: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=400&q=70',
    quote: 'The academy shaped my art from the very first pencil stroke.',
  },
  {
    name: 'Rahul Ghosh',
    course: 'Bisharad',
    img: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=70',
    quote: 'Supportive teachers and a real love for fine art here.',
  },
  {
    name: 'Priya Sen',
    course: 'Ratna',
    img: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&w=400&q=70',
    quote: 'I built a full portfolio and won my first exhibition.',
  },
  {
    name: 'Arjun Roy',
    course: 'Junior',
    img: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=400&q=70',
    quote: 'Every class feels like play but I learn so much.',
  },
]

function Navbar({ onAdmission }) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`nav ${scrolled ? 'nav--scrolled' : ''}`}>
      <div className="container nav__inner">
        <a href="#home" className="nav__brand" onClick={() => setOpen(false)}>
          <Logo size={52} />
          <span className="nav__brand-text">
            <strong>The Indian Music &amp; Fine Art Academy</strong>
            <small>West Bengal, India</small>
          </span>
        </a>

        <button
          className="nav__toggle"
          aria-label="Toggle menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span /><span /><span />
        </button>

        <nav className={`nav__links ${open ? 'is-open' : ''}`}>
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={() => setOpen(false)}>
              {n.label}
            </a>
          ))}
          <a href="#contact" className="btn btn--sm" onClick={(e) => { e.preventDefault(); setOpen(false); onAdmission() }}>
            Admission
          </a>
        </nav>
      </div>
    </header>
  )
}

function Hero({ onAdmission }) {
  return (
    <section id="home" className="hero">
      <div className="hero__overlay" />
      <div className="container hero__inner">
        <div className="hero__badge">
          <Logo size={130} />
        </div>
        <h1 className="hero__title">
          The Indian Music &amp; <span>Fine Art Academy</span>
        </h1>
        <p className="hero__sub">
          A recognised institution nurturing young artists in drawing, painting
          and fine art across West Bengal, India.
        </p>
        <div className="hero__cta">
          <a href="#courses" className="btn">Explore Courses</a>
          <a href="#contact" className="btn btn--ghost" onClick={(e) => { e.preventDefault(); onAdmission() }}>Join Now</a>
        </div>
        <ul className="hero__pills">
          <li>Sub Junior</li>
          <li>Junior</li>
          <li>Senior Diploma</li>
          <li>Bisharad</li>
          <li>Ratna</li>
        </ul>
      </div>
    </section>
  )
}

function Stats() {
  const items = [
    ['25+', 'Years of Teaching'],
    ['5000+', 'Students Trained'],
    ['5', 'Diploma Levels'],
    ['100%', 'Passion for Art'],
  ]
  return (
    <section className="stats">
      <div className="container stats__grid">
        {items.map(([n, l]) => (
          <div key={l} className="stats__item">
            <div className="stats__num">{n}</div>
            <div className="stats__label">{l}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function About() {
  return (
    <section id="about" className="section">
      <div className="container about">
        <div className="about__media">
          <img
            src="https://images.unsplash.com/photo-1465101046530-73398c7f28ca?auto=format&fit=crop&w=900&q=70"
            alt="Art class in progress"
            loading="lazy"
          />
          <div className="about__media-badge">
            <Logo size={72} />
          </div>
        </div>
        <div className="about__text">
          <span className="eyebrow">About the Academy</span>
          <h2>Where young talent becomes true fine art</h2>
          <p>
            The Indian Music &amp; Fine Art Academy is a dedicated centre for
            drawing and fine-art education in West Bengal. Affiliated with the
            Indian Fine Arts Association (New Delhi) — a self-organised board
            across India — we guide every student from their first sketch to a
            professional portfolio.
          </p>
          <p>
            Our structured programme runs from <strong>Sub Junior</strong> right
            up to the prestigious <strong>Ratna</strong> honour, with
            examinations and diplomas recognised nationwide.
          </p>
          <ul className="ticks">
            <li>Experienced fine-art instructors</li>
            <li>Recognised diplomas &amp; certificates</li>
            <li>Annual exhibitions &amp; competitions</li>
            <li>Friendly, creative environment</li>
          </ul>
        </div>
      </div>
    </section>
  )
}

function Courses() {
  return (
    <section id="courses" className="section section--tint">
      <div className="container">
        <div className="section__head">
          <span className="eyebrow">Our Programme</span>
          <h2>Courses &amp; Diploma Levels</h2>
          <p>A clear path of growth for every age and skill level.</p>
        </div>
        <div className="courses__grid">
          {COURSES.map((c) => (
            <article key={c.level} className="course-card">
              <div className="course-card__icon">{c.icon}</div>
              <h3>{c.level}</h3>
              <p>{c.desc}</p>
              <a href="#contact" className="course-card__link">Enquire →</a>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Gallery() {
  return (
    <section id="gallery" className="section">
      <div className="container">
        <div className="section__head">
          <span className="eyebrow">Student Work</span>
          <h2>Gallery</h2>
          <p>A glimpse of the creativity from our classrooms.</p>
        </div>
        <div className="gallery__grid">
          {GALLERY.map((g, i) => (
            <figure key={i} className="gallery__item">
              <img src={g.src} alt={g.alt} loading="lazy" />
            </figure>
          ))}
        </div>
      </div>
    </section>
  )
}

function Students() {
  return (
    <section className="section section--tint">
      <div className="container">
        <div className="section__head">
          <span className="eyebrow">Our Students</span>
          <h2>Faces of the Academy</h2>
          <p>Meet a few of the young artists growing with us.</p>
        </div>
        <div className="students__grid">
          {STUDENTS.map((s) => (
            <article key={s.name} className="student-card">
              <div className="student-card__photo">
                <img src={s.img} alt={s.name} loading="lazy" />
              </div>
              <h3>{s.name}</h3>
              <span className="student-card__course">{s.course}</span>
              <p>“{s.quote}”</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

function Board() {
  return (
    <section id="board" className="section">
      <div className="container board">
        <div className="board__seal">
          <Logo size={190} />
        </div>
        <div className="board__text">
          <span className="eyebrow">Recognition &amp; Registration</span>
          <h2>An officially recognised board</h2>
          <div className="board__facts">
            <div>
              <h4>Affiliation</h4>
              <p>Indian Fine Arts Association (New Delhi) — Self Organised Board of all over India.</p>
            </div>
            <div>
              <h4>Registered As</h4>
              <p>B.M.F.A.A.</p>
            </div>
            <div>
              <h4>Government Registration</h4>
              <p>Govt. of West Bengal Societies Registration Act XXVI of 1961.</p>
            </div>
            <div>
              <h4>Examinations</h4>
              <p>Sub Junior / Junior / Senior Diploma / Bisharad / Ratna.</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Contact() {
  const [sent, setSent] = useState(false)
  return (
    <section id="contact" className="section section--tint">
      <div className="container contact">
        <div className="contact__info">
          <span className="eyebrow">Admissions Open</span>
          <h2>Get in touch</h2>
          <p>
            Interested in enrolling? Send us your details and our team will
            reach out with course and examination information.
          </p>
          <ul className="contact__list">
            <li><strong>📍 Location</strong> West Bengal, India</li>
            <li><strong>✉️ Email</strong> info@indianfineartacademy.in</li>
            <li><strong>📞 Phone</strong> +91 00000 00000</li>
            <li><strong>🕘 Hours</strong> Mon – Sat, 10:00 – 18:00</li>
          </ul>
        </div>
        <form
          className="contact__form"
          onSubmit={(e) => {
            e.preventDefault()
            setSent(true)
          }}
        >
          {sent ? (
            <div className="contact__thanks">
              <h3>Thank you! 🎉</h3>
              <p>Your enquiry has been received. We’ll contact you soon.</p>
            </div>
          ) : (
            <>
              <label>
                Full Name
                <input type="text" name="name" required placeholder="Your name" />
              </label>
              <label>
                Email / Phone
                <input type="text" name="contact" required placeholder="How can we reach you?" />
              </label>
              <label>
                Interested Course
                <select name="course" defaultValue="">
                  <option value="" disabled>Select a level</option>
                  {COURSES.map((c) => (
                    <option key={c.level} value={c.level}>{c.level}</option>
                  ))}
                </select>
              </label>
              <label>
                Message
                <textarea name="message" rows="4" placeholder="Tell us about the student…" />
              </label>
              <button type="submit" className="btn btn--full">Submit Enquiry</button>
            </>
          )}
        </form>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <Logo size={64} />
          <div>
            <strong>The Indian Music &amp; Fine Art Academy</strong>
            <p>West Bengal, India</p>
          </div>
        </div>
        <nav className="footer__nav">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`}>{n.label}</a>
          ))}
        </nav>
        <p className="footer__copy">
          © {new Date().getFullYear()} The Indian Music &amp; Fine Art Academy.
          All rights reserved.
        </p>
      </div>
    </footer>
  )
}

export default function App() {
  const [admissionOpen, setAdmissionOpen] = useState(false)
  const openAdmission = () => setAdmissionOpen(true)
  const closeAdmission = () => setAdmissionOpen(false)

  // Public shared registration link: /register
  if (typeof window !== 'undefined' && window.location.pathname.replace(/\/$/, '') === '/register') {
    return (
      <div className="public-reg-page">
        <PublicRegister />
      </div>
    )
  }

  return (
    <>
      <Navbar onAdmission={openAdmission} />
      <main>
        <Hero onAdmission={openAdmission} />
        <Stats />
        <About />
        <Courses />
        <Gallery />
        <Students />
        <Board />
        <Contact />
      </main>
      <Footer />
      <Admission open={admissionOpen} onClose={closeAdmission} />
    </>
  )
}
