// The author's name with links to GitHub and LinkedIn (Welcome card). Same line as in Quaera Model.

export const AUTHOR_GITHUB_URL = 'https://github.com/StanislavSidorovich'
export const AUTHOR_LINKEDIN_URL = 'https://www.linkedin.com/in/stanislavsidorovich'

export function AuthorLinks() {
  return (
    <p className="welcome-small author-links">
      Made by Stanislav Sidorovich ·{' '}
      <a href={AUTHOR_GITHUB_URL} target="_blank" rel="noopener">
        GitHub
      </a>{' '}
      ·{' '}
      <a href={AUTHOR_LINKEDIN_URL} target="_blank" rel="noopener">
        LinkedIn
      </a>
    </p>
  )
}
