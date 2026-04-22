// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { JsonLd } from '../JsonLd'

describe('<JsonLd>', () => {
  it('renders a script tag with type application/ld+json', () => {
    const { container } = render(
      <JsonLd data={{ '@context': 'https://schema.org', '@type': 'Thing' }} />,
    )
    const script = container.querySelector('script[type="application/ld+json"]')
    expect(script).not.toBeNull()
  })

  it('escapes the literal "<" so a closing </script> in user content cannot break out', () => {
    const { container } = render(
      <JsonLd data={{ note: '</script><script>alert(1)</script>' }} />,
    )
    const script = container.querySelector('script[type="application/ld+json"]')!
    // Raw HTML should not contain the closing-script sequence inside the JSON-LD.
    expect(script.innerHTML).not.toContain('</script>')
    expect(script.innerHTML).toContain('\\u003c')
  })

  it('emits valid JSON', () => {
    const data = { '@context': 'https://schema.org', '@type': 'Person', name: 'Anna' }
    const { container } = render(<JsonLd data={data} />)
    const script = container.querySelector('script[type="application/ld+json"]')!
    // Reverse the unicode escape so JSON.parse works on the literal payload.
    const raw = script.innerHTML.replace(/\\u003c/g, '<')
    expect(() => JSON.parse(raw)).not.toThrow()
    const parsed = JSON.parse(raw)
    expect(parsed.name).toBe('Anna')
  })
})
