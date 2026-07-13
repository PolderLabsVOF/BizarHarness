import { describe, it, expect } from 'vitest';
import { t, setLocale, getLocale } from '../../src/web/lib/i18n';

describe('i18n', () => {
  it('t() returns the key if no translation exists', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  it('t() returns translation if registered', () => {
    setLocale('en', { 'hello': 'Hello World' });
    expect(t('hello')).toBe('Hello World');
  });

  it('setLocale() switches locale and getLocale() reflects it', () => {
    setLocale('en');
    expect(getLocale()).toBe('en');

    setLocale('fr');
    expect(getLocale()).toBe('fr');

    setLocale('de', { greet: 'Hallo' });
    expect(getLocale()).toBe('de');
    expect(t('greet')).toBe('Hallo');
  });

  it('supports variable interpolation with {varName} syntax', () => {
    setLocale('en', {
      greeting: 'Hello, {name}!',
      ageMsg: '{name} is {age} years old',
    });
    expect(t('greeting', { name: 'World' })).toBe('Hello, World!');
    expect(t('ageMsg', { name: 'Alice', age: 30 })).toBe('Alice is 30 years old');
  });

  it('falls back to en translations when current locale is missing a key', () => {
    setLocale('en', { shared: 'English text' });
    setLocale('fr', { local: 'Texte français' });

    // 'shared' is not in fr, should fall back to en
    expect(t('shared')).toBe('English text');
    // 'local' is in fr
    expect(t('local')).toBe('Texte français');
    // Neither locale has this
    expect(t('missing')).toBe('missing');
  });
});
