import { describe, expect, it } from 'vitest';
import { initializeDatabase } from '../storage/database';
import { SkillsEngine } from './engine';

describe('SkillsEngine', () => {
  it('seeds starter skills once and lists them', () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    skills.seedStarter();
    skills.seedStarter();
    const list = skills.list();
    expect(list.length).toBe(3);
    expect(list.map((skill) => skill.id)).toContain('starter-code-review');
    database.close();
  });

  it('ranks relevant enabled skills and renders their instructions', () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    skills.seedStarter();
    const selected = skills.select('please review this code change for regressions');
    expect(selected[0]?.name).toBe('Code review');
    const block = skills.renderForPrompt(selected);
    expect(block).toContain('### Skill: Code review');
    expect(block).toContain('Prioritize concrete bugs');
    database.close();
  });

  it('resolves by id or name, saves, toggles, and removes custom skills', () => {
    const database = initializeDatabase(':memory:');
    const skills = new SkillsEngine(database);
    skills.seedStarter();
    expect(skills.resolve('Code review')?.id).toBe('starter-code-review');

    skills.save({
      id: 'custom-release',
      name: 'Release checklist',
      description: 'Verify a release before publishing.',
      category: 'Development',
      instructions: 'Run tests, check the changelog, and tag the release.',
      enabled: true,
      source: 'Custom',
    });
    expect(skills.resolve('release checklist')?.instructions).toContain('changelog');
    expect(skills.select('prepare a release').some((skill) => skill.id === 'custom-release')).toBe(true);

    skills.save({
      id: 'custom-release',
      name: 'Release checklist',
      description: 'Verify a release before publishing.',
      category: 'Development',
      instructions: 'Run tests, check the changelog, and tag the release.',
      enabled: false,
      source: 'Custom',
    });
    expect(skills.select('prepare a release').some((skill) => skill.id === 'custom-release')).toBe(false);

    skills.remove('custom-release');
    expect(skills.get('custom-release')).toBeNull();
    database.close();
  });
});
