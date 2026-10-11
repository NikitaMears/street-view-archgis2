/** @jsx jsx */
import { React, jsx, type AllWidgetProps, WidgetState } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'
import { Button } from 'jimu-ui'
import Graphic from 'esri/Graphic'
import * as webMercatorUtils from 'esri/geometry/support/webMercatorUtils'
import type { IMConfig, ImagerySource } from '../config'
import defaultMessages from './translations/default'
import { getStyle } from './style'

interface State {
  lat?: number
  lon?: number
  streetViewUrl?: string
  customPopupOpen: boolean
  captureEnabled: boolean
  mapillaryImageId?: string
  mapillaryStatus?: 'loading' | 'found' | 'not-found' | 'error'
}

/** How far (in degrees, about 50 m) to search around the clicked point for Mapillary images. */
const MAPILLARY_SEARCH_RADIUS = 0.0005

const MARKER_SYMBOL = {
  type: 'simple-marker',
  style: 'circle',
  color: [220, 53, 69, 0.95],
  size: 12,
  outline: { color: [255, 255, 255, 1], width: 2 }
}

const ignoreError = (): void => undefined

const getStreetViewUrl = (lat: number, lon: number): string =>
  `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(`${lat},${lon}`)}`

const getEmbedUrl = (apiKey: string, lat: number, lon: number): string =>
  `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(apiKey)}&location=${lat},${lon}`

const getMapillaryEmbedUrl = (imageId: string): string =>
  `https://www.mapillary.com/embed?image_key=${encodeURIComponent(imageId)}&style=photo`

const getMapillaryAppUrl = (imageId: string): string =>
  `https://www.mapillary.com/app/?pKey=${encodeURIComponent(imageId)}`

/** Returns the id of the Mapillary image closest to lat/lon, or null if there is none nearby. */
const findNearestMapillaryImage = async (
  accessToken: string,
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<string | null> => {
  const r = MAPILLARY_SEARCH_RADIUS
  const params = new URLSearchParams({
    access_token: accessToken,
    fields: 'id,computed_geometry,geometry',
    bbox: [lon - r, lat - r, lon + r, lat + r].join(','),
    limit: '50'
  })

  const response = await fetch(`https://graph.mapillary.com/images?${params.toString()}`, { signal })
  if (!response.ok) throw new Error(`Mapillary request failed: ${response.status}`)

  const { data = [] } = await response.json()
  let nearestId: string | null = null
  let nearestDistance = Infinity

  for (const image of data) {
    const [imageLon, imageLat] = (image.computed_geometry ?? image.geometry)?.coordinates ?? []
    if (imageLon == null || imageLat == null) continue

    const distance = (imageLon - lon) ** 2 + (imageLat - lat) ** 2
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestId = image.id
    }
  }

  return nearestId
}

/** Converts a point to WGS84 (lat/lon). Returns null for unsupported spatial references. */
const toWgs84 = (point: __esri.Point): __esri.Point | null => {
  const sr = point?.spatialReference
  if (sr?.isWGS84) return point
  if (sr?.isWebMercator) return webMercatorUtils.webMercatorToGeographic(point) as __esri.Point
  return null
}

export default class Widget extends React.PureComponent<AllWidgetProps<IMConfig>, State> {
  state: State = {
    customPopupOpen: false,
    captureEnabled: true
  }

  private jimuMapView: JimuMapView | null = null
  private clickHandle: { remove: () => void } | null = null
  private markerGraphic: Graphic | null = null
  private markerView: __esri.View | null = null
  private mapillaryRequest: AbortController | null = null

  // ---------- Lifecycle ----------

  componentDidUpdate (prevProps: AllWidgetProps<IMConfig>): void {
    if (prevProps.state === this.props.state) return

    // Only listen for map clicks while the widget is open.
    if (this.isWidgetOpened()) {
      this.addClickHandler()
    } else {
      this.removeClickHandler()
    }
  }

  componentWillUnmount (): void {
    this.removeClickHandler()
    this.clearMarker()
    this.mapillaryRequest?.abort()
    this.jimuMapView = null
  }

  // ---------- Helpers ----------

  nls = (id: keyof typeof defaultMessages): string => {
    return this.props.intl.formatMessage({ id, defaultMessage: defaultMessages[id] })
  }

  private get apiKey (): string | undefined {
    return this.props.config.googleEmbedApiKey?.trim() || undefined
  }

  private get imagerySource (): ImagerySource {
    return this.props.config.imagerySource || 'google'
  }

  private get mapillaryToken (): string | undefined {
    return this.props.config.mapillaryAccessToken?.trim() || undefined
  }

  /** True when the selected imagery source has the credentials needed to show imagery inside the widget. */
  private get canEmbed (): boolean {
    return this.imagerySource === 'mapillary' ? Boolean(this.mapillaryToken) : Boolean(this.apiKey)
  }

  private get centerMapOnClick (): boolean {
    return this.props.config.centerMapOnClick ?? true
  }

  private isWidgetOpened (): boolean {
    return this.props.state == null || this.props.state === WidgetState.Opened
  }

  // ---------- Map click handling ----------

  private readonly onActiveViewChange = (jimuMapView: JimuMapView): void => {
    if (!jimuMapView?.view) return

    // Switching to a different map view: drop everything tied to the old one.
    if (this.jimuMapView?.view !== jimuMapView.view) {
      this.removeClickHandler()
      this.clearCurrentPoint()
      this.jimuMapView = jimuMapView
    }

    this.addClickHandler()
  }

  private addClickHandler (): void {
    const view = this.jimuMapView?.view
    if (!view || this.clickHandle || !this.isWidgetOpened()) return

    this.clickHandle = view.on('click', this.onMapClick)
  }

  private removeClickHandler (): void {
    this.clickHandle?.remove()
    this.clickHandle = null
  }

  private readonly onMapClick = (event: __esri.ViewClickEvent): void => {
    const view = this.jimuMapView?.view
    if (!view || !event.mapPoint || !this.state.captureEnabled || !this.isWidgetOpened()) return

    const clickedPoint = event.mapPoint.clone()
    const wgs84Point = toWgs84(clickedPoint)
    if (!wgs84Point) return

    this.setMarker(clickedPoint)

    if (this.centerMapOnClick) {
      view.goTo({ center: clickedPoint }, { animate: false }).catch(ignoreError)
    }

    const lat = Number(wgs84Point.latitude.toFixed(6))
    const lon = Number(wgs84Point.longitude.toFixed(6))
    const streetViewUrl = getStreetViewUrl(lat, lon)
    const openMode = this.props.config.openMode || 'custom-popup'
    const showInWidget = openMode === 'custom-popup'

    this.setState({
      lat,
      lon,
      streetViewUrl,
      customPopupOpen: showInWidget
    })

    // Without credentials there is nothing to show inline, so open Google Maps.
    if (openMode === 'new-tab' || !this.canEmbed) {
      window.open(streetViewUrl, '_blank', 'noopener,noreferrer')
    }

    if (showInWidget && this.imagerySource === 'mapillary' && this.mapillaryToken) {
      this.loadMapillaryImage(this.mapillaryToken, lat, lon)
    }
  }

  private loadMapillaryImage (accessToken: string, lat: number, lon: number): void {
    // Cancel the previous lookup so a slow response can't overwrite a newer click.
    this.mapillaryRequest?.abort()
    const request = new AbortController()
    this.mapillaryRequest = request

    this.setState({ mapillaryImageId: undefined, mapillaryStatus: 'loading' })

    findNearestMapillaryImage(accessToken, lat, lon, request.signal)
      .then((imageId) => {
        this.setState({
          mapillaryImageId: imageId ?? undefined,
          mapillaryStatus: imageId ? 'found' : 'not-found'
        })
      })
      .catch(() => {
        if (!request.signal.aborted) this.setState({ mapillaryStatus: 'error' })
      })
  }

  // ---------- Marker ----------

  private setMarker (point: __esri.Point): void {
    const view = this.jimuMapView?.view
    if (!view) return

    // Always replace the graphic: mutating .geometry does not reliably redraw in EXB.
    this.clearMarker()

    this.markerGraphic = new Graphic({ geometry: point.clone(), symbol: MARKER_SYMBOL as any })
    view.graphics.add(this.markerGraphic)
    this.markerView = view

    // If the map won't be re-centered, "go to" the current center to force a redraw.
    if (!this.centerMapOnClick && view.center) {
      view.goTo({ center: view.center.clone() }, { animate: false }).catch(ignoreError)
    }
  }

  private clearMarker (): void {
    if (this.markerView && this.markerGraphic) {
      this.markerView.graphics.remove(this.markerGraphic)
    }
    this.markerGraphic = null
    this.markerView = null
  }

  /** Nudges the map slightly and back again so the removed marker disappears. */
  private forceRedraw (): void {
    const view = this.jimuMapView?.view
    const center = view?.center?.clone()
    if (!view || !center) return

    const dx = view.resolution ? view.resolution * 0.25 : 0.01
    const nudged = { x: center.x + dx, y: center.y, spatialReference: center.spatialReference }

    view.goTo({ center: nudged }, { animate: false })
      .then(() => view.goTo({ center }, { animate: false }))
      .catch(ignoreError)
  }

  // ---------- Toolbar actions ----------

  private readonly clearCurrentPoint = (): void => {
    this.clearMarker()
    this.mapillaryRequest?.abort()
    this.setState({
      lat: undefined,
      lon: undefined,
      streetViewUrl: undefined,
      customPopupOpen: false,
      mapillaryImageId: undefined,
      mapillaryStatus: undefined
    }, () => { this.forceRedraw() })
  }

  private readonly toggleCapture = (): void => {
    this.setState((prev) => ({ captureEnabled: !prev.captureEnabled }))
  }

  // ---------- Rendering ----------

  private getHint (hasMap: boolean): string {
    if (!hasMap) return this.nls('selectMap')
    return this.state.captureEnabled ? this.nls('clickMap') : this.nls('clickDisabled')
  }

  private renderPreview () {
    const { customPopupOpen, lat, lon, streetViewUrl } = this.state
    if (!customPopupOpen || lat == null || lon == null || streetViewUrl == null) return null

    return (
      <div className="widget-street-view__preview-area">
        <div className="widget-street-view__preview">
          <div className="widget-street-view__preview-coords">
            <strong>{this.nls('coords')}:</strong> {lat}, {lon}
          </div>

          {this.imagerySource === 'mapillary'
            ? this.renderMapillaryPreview(streetViewUrl)
            : this.renderGooglePreview(lat, lon, streetViewUrl)}
        </div>
      </div>
    )
  }

  private renderGooglePreview (lat: number, lon: number, streetViewUrl: string) {
    const apiKey = this.apiKey

    return (
      <React.Fragment>
        {apiKey && this.renderIframe(getEmbedUrl(apiKey, lat, lon))}
        {this.renderLinks([
          { href: streetViewUrl, label: apiKey ? this.nls('openGoogleMaps') : this.nls('openStreetView') }
        ])}
      </React.Fragment>
    )
  }

  private renderMapillaryPreview (streetViewUrl: string) {
    const { mapillaryImageId, mapillaryStatus } = this.state
    const googleLink = { href: streetViewUrl, label: this.nls('openGoogleMaps') }

    if (!this.mapillaryToken) {
      return this.renderLinks([googleLink])
    }

    if (mapillaryStatus === 'found' && mapillaryImageId) {
      return (
        <React.Fragment>
          {this.renderIframe(getMapillaryEmbedUrl(mapillaryImageId))}
          {this.renderLinks([
            { href: getMapillaryAppUrl(mapillaryImageId), label: this.nls('openMapillary') },
            googleLink
          ])}
        </React.Fragment>
      )
    }

    const messages = {
      loading: this.nls('mapillaryLoading'),
      'not-found': this.nls('mapillaryNotFound'),
      error: this.nls('mapillaryError')
    }

    return (
      <React.Fragment>
        <div className="widget-street-view__message">{messages[mapillaryStatus ?? 'loading']}</div>
        {this.renderLinks([googleLink])}
      </React.Fragment>
    )
  }

  private renderIframe (src: string) {
    return (
      <div className="widget-street-view__iframe-wrapper">
        <iframe
          className="widget-street-view__iframe"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          src={src}
        />
      </div>
    )
  }

  private renderLinks (links: Array<{ href: string, label: string }>) {
    return (
      <div className="widget-street-view__actions">
        {links.map(({ href, label }) => (
          <a key={href} href={href} target="_blank" rel="noopener noreferrer">{label}</a>
        ))}
      </div>
    )
  }

  render () {
    const { captureEnabled, lat } = this.state
    const hasMap = this.props.useMapWidgetIds?.length > 0
    const title = this.props.config.widgetTitle?.trim() || this.nls('title')

    return (
      <div className="widget-street-view jimu-widget" css={getStyle()}>
        <div className="widget-street-view__panel">
          <div className="widget-street-view__header">
            <div className="widget-street-view__title">{title}</div>
            <div className="widget-street-view__hint">{this.getHint(hasMap)}</div>
            <div className="widget-street-view__toolbar">
              <Button
                size="sm"
                type={captureEnabled ? 'primary' : 'default'}
                onClick={this.toggleCapture}
              >
                {captureEnabled ? this.nls('deactivateClick') : this.nls('activateClick')}
              </Button>
              <Button size="sm" onClick={this.clearCurrentPoint} disabled={lat == null}>
                {this.nls('clearPoint')}
              </Button>
            </div>
          </div>

          {this.renderPreview()}
        </div>

        {/* Hidden: only used to connect to the selected map widget. */}
        {hasMap && (
          <div className="widget-street-view__map-connection">
            <JimuMapViewComponent
              useMapWidgetId={this.props.useMapWidgetIds[0]}
              onActiveViewChange={this.onActiveViewChange}
            />
          </div>
        )}
      </div>
    )
  }
}
