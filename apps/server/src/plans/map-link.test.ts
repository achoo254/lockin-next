import { describe, expect, it } from 'vitest';
import { isGoogleMapsLink, mapsSearchUrl, placeNameFromMapsLink } from './map-link';
import { CreatePlanInput } from './plan-input';

describe('Google Maps links', () => {
  it('accepts https links on the Google map hosts only', () => {
    for (const good of [
      'https://maps.app.goo.gl/AbCdEf123',
      'https://goo.gl/maps/xyz987',
      'https://www.google.com/maps/place/C%E1%BB%99ng+C%C3%A0+Ph%C3%AA/@10.77,106.69,17z',
      'https://google.com/maps/search/c%C3%A0+ph%C3%AA+qu%E1%BA%ADn+3',
      '  https://maps.app.goo.gl/AbCdEf123  ',
    ])
      expect(isGoogleMapsLink(good)).toBe(true);
    for (const bad of [
      'http://maps.app.goo.gl/AbCdEf123',
      'javascript:alert(1)',
      'https://evil.example/maps/place/x',
      'https://maps.google.com.evil.example/maps/place/x',
      'https://www.google.com/search?q=x',
      'https://www.google.com/maps/',
      'https://goo.gl/abc',
      'https://user:pw@www.google.com/maps/place/x',
      'https://www.google.com:8443/maps/place/x',
      'https://maps.app.goo.gl/',
      'Quán cà phê A',
      `https://maps.app.goo.gl/${'a'.repeat(2100)}`,
    ])
      expect(isGoogleMapsLink(bad)).toBe(false);
  });

  it('reads the place name of a place link, not of a short or search link', () => {
    expect(placeNameFromMapsLink('https://www.google.com/maps/place/C%E1%BB%99ng+C%C3%A0+Ph%C3%AA/@10.77,106.69,17z/data=x')).toBe('Cộng Cà Phê');
    expect(placeNameFromMapsLink('https://www.google.com/maps/place/@10.77,106.69,17z')).toBeNull();
    expect(placeNameFromMapsLink('https://maps.app.goo.gl/AbCdEf123')).toBeNull();
    expect(placeNameFromMapsLink('https://google.com/maps/search/cafe')).toBeNull();
    expect(placeNameFromMapsLink('https://www.google.com/maps/place/%E0%A4%A')).toBeNull();
  });

  it('builds a keyless search link with the area, Vietnamese diacritics encoded', () => {
    expect(mapsSearchUrl('Quán cà phê B', 'Quận 3')).toBe('https://www.google.com/maps/search/?api=1&query=Qu%C3%A1n%20c%C3%A0%20ph%C3%AA%20B%2C%20Qu%E1%BA%ADn%203');
    expect(mapsSearchUrl('Bún chả Hương Liên', null)).toBe(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent('Bún chả Hương Liên')}`);
  });

  it('keeps a valid map link on a place option and refuses any other link there', () => {
    const body = (mapUrl: unknown): unknown => ({
      title: 'Cà phê',
      activity: 'coffee',
      voteDeadline: new Date(Date.now() + 3_600_000).toISOString(),
      options: [{ kind: 'place', label: 'Cộng', mapUrl }],
    });
    const parsed = CreatePlanInput.safeParse(body('https://maps.app.goo.gl/AbC'));
    expect(parsed.success && parsed.data.options[0]).toEqual({ kind: 'place', label: 'Cộng', mapUrl: 'https://maps.app.goo.gl/AbC' });
    expect(CreatePlanInput.safeParse(body(null)).success).toBe(true);
    for (const bad of ['javascript:alert(1)', 'http://maps.app.goo.gl/AbC', 'https://evil.example/maps/place/x', 42]) expect(CreatePlanInput.safeParse(body(bad)).success).toBe(false);
  });
});
