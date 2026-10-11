import type { ImmutableObject } from 'jimu-core'

export type OpenMode = 'custom-popup' | 'new-tab'

export type ImagerySource = 'google' | 'mapillary'

export interface Config {
  widgetTitle?: string
  imagerySource?: ImagerySource
  googleEmbedApiKey?: string
  mapillaryAccessToken?: string
  openMode?: OpenMode
  centerMapOnClick?: boolean
}

export type IMConfig = ImmutableObject<Config>
