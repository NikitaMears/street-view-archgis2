/** @jsx jsx */
import { React, jsx, type AllWidgetProps, WidgetState } from 'jimu-core'
import { JimuMapViewComponent, type JimuMapView } from 'jimu-arcgis'
import { Button } from 'jimu-ui'
import Graphic from 'esri/Graphic'
import * as webMercatorUtils from 'esri/geometry/support/webMercatorUtils'
import type { IMConfig } from '../config'
import defaultMessages from './translations/default'
import { getStyle } from './style'

type ImageStatus = 'loading' | 'found' | 'not-found' | 'error'

interface State {
  lat?: number
  lon?: number
  customPopupOpen: boolean
  captureEnabled: boolean
  imageId?: string
  imageStatus?: ImageStatus
}

/** How far (in degrees, about 50 m) to search around the clicked point for Mapillary images. */
const SEARCH_RADIUS = 0.0005

const MARKER_SYMBOL = {
  type: 'simple-marker',
  style: 'circle',
  color: [220, 53, 69, 0.95],
  size: 12,
  outline: { color: [255, 255, 255, 1], width: 2 }
}

const ignoreError = (): void => undefined

/** Mapillary web app centered on a location (works without a token). */
const getMapillaryMapUrl = (lat: number, lon: number): string =>
  `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=17`

/** Mapillary web app opened on a specific image. */
const getMapillaryImageUrl = (imageId: string): string =>
  `https://www.mapillary.com/app/?pKey=${encodeURIComponent(imageId)}`

const getMapillaryEmbedUrl = (imageId: string): string =>
  `https://www.mapillary.com/embed?image_key=${encodeURIComponent(imageId)}&style=photo`

/** Returns the id of the Mapillary image closest to lat/lon, or null if there is none nearby. */
const findNearestImage = async (
  accessToken: string,
  lat: number,
  lon: number,
  signal: AbortSignal
): Promise<string | null> => {
  const r = SEARCH_RADIUS
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
  private imageRequest: AbortController | null = null

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
    this.imageRequest?.abort()
    this.jimuMapView = null
  }

  // ---------- Helpers ----------

  nls = (id: keyof typeof defaultMessages): string => {
    return this.props.intl.formatMessage({ id, defaultMessage: defaultMessages[id] })
  }

  private get accessToken (): string | undefined {
    return this.props.config.mapillaryAccessToken?.trim() || undefined
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
    const showInWidget = (this.props.config.openMode || 'custom-popup') === 'custom-popup'
    const accessToken = this.accessToken

    this.setState({ lat, lon, customPopupOpen: showInWidget })

    if (showInWidget && accessToken) {
      this.loadNearestImage(accessToken, lat, lon)
    } else {
      // New-tab mode, or no token to look up imagery: open the Mapillary web app instead.
      window.open(getMapillaryMapUrl(lat, lon), '_blank', 'noopener,noreferrer')
    }
  }

  private loadNearestImage (accessToken: string, lat: number, lon: number): void {
    // Cancel the previous lookup so a slow response can't overwrite a newer click.
    this.imageRequest?.abort()
    const request = new AbortController()
    this.imageRequest = request

    this.setState({ imageId: undefined, imageStatus: 'loading' })

    findNearestImage(accessToken, lat, lon, request.signal)
      .then((imageId) => {
        this.setState({
          imageId: imageId ?? undefined,
          imageStatus: imageId ? 'found' : 'not-found'
        })
      })
      .catch(() => {
        if (!request.signal.aborted) this.setState({ imageStatus: 'error' })
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
    this.imageRequest?.abort()
    this.setState({
      lat: undefined,
      lon: undefined,
      customPopupOpen: false,
      imageId: undefined,
      imageStatus: undefined
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

  private getStatusMessage (): string {
    if (!this.accessToken) return this.nls('noAccessToken')

    switch (this.state.imageStatus) {
      case 'not-found': return this.nls('imageNotFound')
      case 'error': return this.nls('imageError')
      default: return this.nls('imageLoading')
    }
  }

  private renderPreview () {
    const { customPopupOpen, lat, lon, imageId, imageStatus } = this.state
    if (!customPopupOpen || lat == null || lon == null) return null

    const foundImageId = imageStatus === 'found' ? imageId : undefined

    return (
      <div className="widget-street-view__preview-area">
        <div className="widget-street-view__preview">
          <div className="widget-street-view__preview-coords">
            <strong>{this.nls('coords')}:</strong> {lat}, {lon}
          </div>

          {foundImageId
            ? (
              <div className="widget-street-view__iframe-wrapper">
                <iframe
                  className="widget-street-view__iframe"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                  src={getMapillaryEmbedUrl(foundImageId)}
                />
              </div>
              )
            : <div className="widget-street-view__message">{this.getStatusMessage()}</div>}

          <div className="widget-street-view__actions">
            <a
              href={foundImageId ? getMapillaryImageUrl(foundImageId) : getMapillaryMapUrl(lat, lon)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {this.nls('openMapillary')}
            </a>
          </div>
        </div>
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
