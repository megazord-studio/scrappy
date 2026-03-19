import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Scrappy',
  description: 'AI-powered structured web scraping pipeline',
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/guide/what-is-scrappy' },
      { text: 'Schemas', link: '/schemas/overview' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'What is Scrappy?', link: '/guide/what-is-scrappy' },
          { text: 'Getting Started', link: '/guide/getting-started' },
          { text: 'Index Jobs', link: '/guide/index-jobs' },
          { text: 'Update Jobs', link: '/guide/update-jobs' },
          { text: 'Web UI', link: '/guide/web-ui' },
        ],
      },
      {
        text: 'Schemas',
        items: [
          { text: 'Overview', link: '/schemas/overview' },
          { text: 'Field Descriptions', link: '/schemas/field-descriptions' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API', link: '/reference/api' },
          { text: 'LLM Providers', link: '/reference/llm-providers' },
          { text: 'Architecture', link: '/reference/architecture' },
          { text: 'CLI', link: '/reference/cli' },
        ],
      },
    ],
    socialLinks: [],
  },
})
