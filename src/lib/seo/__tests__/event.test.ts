import { describe, it, expect } from 'vitest'
import { eventJsonLd } from '../event'
import type { EventDetail } from '@/types'

function makeEvent(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 'evt-1',
    slug: 'wine-night',
    title: 'Wine Night',
    description: 'long',
    short_description: 'short',
    date_time: '2026-05-01T18:00:00.000Z',
    end_time: '2026-05-01T22:00:00.000Z',
    venue_name: 'Borough Market',
    venue_address: '8 Southwark St',
    postcode: 'SE1 1TL',
    venue_revealed: true,
    category: 'drinks',
    price: 3500,
    capacity: 30,
    image_url: null,
    dress_code: null,
    is_published: true,
    is_cancelled: false,
    created_at: '2026-04-01T00:00:00Z',
    updated_at: '2026-04-15T10:00:00Z',
    deleted_at: null,
    confirmed_count: 10,
    avg_rating: 0,
    review_count: 0,
    spots_left: 20,
    hosts: [],
    inclusions: [],
    ...overrides,
  } as EventDetail
}

describe('eventJsonLd', () => {
  it('emits Event schema with venue address when venue_revealed=true', () => {
    const ld = eventJsonLd(makeEvent())
    expect(ld['@type']).toBe('Event')
    const location = ld.location as { name: string; address: { streetAddress: string } }
    expect(location.name).toBe('Borough Market')
    expect(location.address.streetAddress).toBe('8 Southwark St')
  })

  it('hides the real venue when venue_revealed=false (P2-5 hazard)', () => {
    const ld = eventJsonLd(makeEvent({ venue_revealed: false }))
    const location = ld.location as { name: string; address: Record<string, string> }
    expect(location.name).toBe('Venue revealed 1 week before the event')
    expect(location.address.streetAddress).toBeUndefined()
  })

  it('omits aggregateRating entirely when there are no reviews', () => {
    const ld = eventJsonLd(makeEvent({ review_count: 0, avg_rating: 0 }))
    expect('aggregateRating' in ld).toBe(false)
  })

  it('emits aggregateRating when reviews exist', () => {
    const ld = eventJsonLd(makeEvent({ review_count: 4, avg_rating: 4.6 }))
    const ar = ld.aggregateRating as Record<string, unknown>
    expect(ar['@type']).toBe('AggregateRating')
    expect(ar.ratingValue).toBe(4.6)
    expect(ar.ratingCount).toBe(4)
  })

  it('emits performer entries for hosts (with optional jobTitle/worksFor)', () => {
    const ld = eventJsonLd(
      makeEvent({
        hosts: [
          {
            id: 'h1',
            event_id: 'evt-1',
            profile_id: 'p1',
            role_label: 'Host',
            sort_order: 0,
            created_at: '',
            profile: {
              id: 'p1',
              full_name: 'Anna Lee',
              avatar_url: null,
              bio: null,
              job_title: 'Sommelier',
              company: 'Cellar Co',
            },
          },
        ],
      }),
    )
    const performer = ld.performer as Array<Record<string, unknown>>
    expect(performer).toHaveLength(1)
    expect(performer[0].name).toBe('Anna Lee')
    expect(performer[0].jobTitle).toBe('Sommelier')
    expect((performer[0].worksFor as { name: string }).name).toBe('Cellar Co')
  })

  it('marks offer SoldOut when capacity reached', () => {
    const ld = eventJsonLd(makeEvent({ capacity: 30, spots_left: 0 }))
    const offers = ld.offers as { availability: string }
    expect(offers.availability).toBe('https://schema.org/SoldOut')
  })

  it('marks offer InStock when capacity null (unlimited)', () => {
    const ld = eventJsonLd(makeEvent({ capacity: null, spots_left: null }))
    const offers = ld.offers as { availability: string }
    expect(offers.availability).toBe('https://schema.org/InStock')
  })

  it('converts offer price from pence to pounds with 2 decimal places', () => {
    // 3500 pence = £35.00, NOT £3,500.
    const ld = eventJsonLd(makeEvent({ price: 3500 }))
    const offers = ld.offers as { price: string; priceCurrency: string }
    expect(offers.price).toBe('35.00')
    expect(offers.priceCurrency).toBe('GBP')
  })

  it('formats sub-pound prices correctly', () => {
    const ld = eventJsonLd(makeEvent({ price: 50 }))
    const offers = ld.offers as { price: string }
    expect(offers.price).toBe('0.50')
  })

  it('handles free events as £0.00', () => {
    const ld = eventJsonLd(makeEvent({ price: 0 }))
    const offers = ld.offers as { price: string }
    expect(offers.price).toBe('0.00')
  })
})
