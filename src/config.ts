import type { ImmutableObject } from 'jimu-core'

export type OpenMode = 'custom-popup' | 'new-tab'

export interface Config {
  widgetTitle?: string
  mapillaryAccessToken?: string
  openMode?: OpenMode
  centerMapOnClick?: boolean
}

export type IMConfig = ImmutableObject<Config>
