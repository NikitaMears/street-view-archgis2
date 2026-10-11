/** @jsx jsx */
import { React, jsx, type IntlShape } from 'jimu-core'
import type { AllWidgetSettingProps } from 'jimu-for-builder'
import { SettingSection, SettingRow, MapWidgetSelector } from 'jimu-ui/advanced/setting-components'
import type { Config, IMConfig, OpenMode } from '../config'
import defaultMessages from './translations/default'

const BRAND_COLOR = '#003865'
const SUCCESS_COLOR = '#2e7d32'
const WARNING_COLOR = '#856404'

const styles: Record<string, React.CSSProperties> = {
  sectionTitle: { fontWeight: 700, margin: '12px 0 8px 0', color: BRAND_COLOR, textTransform: 'uppercase', fontSize: '12px', letterSpacing: '0.4px' },
  fieldLabel: { fontWeight: 500, marginBottom: 6 },
  field: { width: 'calc(100% - 16px)', maxWidth: '260px' },
  fullWidth: { width: '100%' },
  mapStatus: { marginTop: 6, fontSize: '12px', fontWeight: 600 },
  tosWarning: {
    fontSize: '11px',
    color: WARNING_COLOR,
    background: '#fff3cd',
    border: '1px solid #ffc107',
    borderRadius: '4px',
    padding: '8px',
    lineHeight: '1.4'
  }
}

export default class Setting extends React.PureComponent<AllWidgetSettingProps<IMConfig>> {
  nls = (id: keyof typeof defaultMessages): string => {
    const intl = this.props.intl as IntlShape | undefined
    return intl ? intl.formatMessage({ id, defaultMessage: defaultMessages[id] }) : defaultMessages[id]
  }

  private setConfig<K extends keyof Config> (key: K, value: Config[K]): void {
    this.props.onSettingChange({ id: this.props.id, config: this.props.config.set(key, value) })
  }

  onMapWidgetSelected = (useMapWidgetIds: string[]) => {
    this.props.onSettingChange({ id: this.props.id, useMapWidgetIds: useMapWidgetIds ?? [] })
  }

  onTitleChange = (evt: React.ChangeEvent<HTMLInputElement>) => { this.setConfig('widgetTitle', evt.currentTarget.value) }
  onModeChange = (evt: React.ChangeEvent<HTMLSelectElement>) => { this.setConfig('openMode', evt.currentTarget.value as OpenMode) }
  onCenterMapOnClickChange = (evt: React.ChangeEvent<HTMLInputElement>) => { this.setConfig('centerMapOnClick', evt.currentTarget.checked) }
  onApiKeyChange = (evt: React.ChangeEvent<HTMLInputElement>) => { this.setConfig('googleEmbedApiKey', evt.currentTarget.value) }

  /** A labelled field inside its own setting row. */
  private renderField (label: string, content: React.ReactNode) {
    return (
      <SettingRow>
        <div style={styles.field}>
          <div style={styles.fieldLabel}>{label}</div>
          {content}
        </div>
      </SettingRow>
    )
  }

  render () {
    const { config } = this.props
    const hasApiKey = Boolean(config.googleEmbedApiKey?.trim())
    const useMapWidgetIds = this.props.useMapWidgetIds ?? []
    const hasMapConnected = useMapWidgetIds.length > 0

    return (
      <div className="widget-setting-street-view p-2" style={styles.fullWidth}>
        <div style={styles.sectionTitle}>{this.nls('mapSection')}</div>
        <SettingSection>
          {this.renderField(this.nls('selectMap'), (
            <React.Fragment>
              <MapWidgetSelector useMapWidgetIds={useMapWidgetIds} onSelect={this.onMapWidgetSelected} />
              <div style={{ ...styles.mapStatus, color: hasMapConnected ? SUCCESS_COLOR : WARNING_COLOR }}>
                {hasMapConnected ? `✓ ${this.nls('mapConnected')}` : this.nls('mapNotConnected')}
              </div>
            </React.Fragment>
          ))}
        </SettingSection>

        <div style={styles.sectionTitle}>{this.nls('displaySection')}</div>
        <SettingSection>
          {this.renderField(this.nls('titleLabel'), (
            <input style={styles.fullWidth} value={config.widgetTitle || ''} onChange={this.onTitleChange} />
          ))}

          {this.renderField(this.nls('openMode'), (
            <select style={styles.fullWidth} value={config.openMode || 'custom-popup'} onChange={this.onModeChange}>
              <option value="custom-popup">{this.nls('modeCustomPopup')}</option>
              <option value="new-tab">{this.nls('modeNewTab')}</option>
            </select>
          ))}

          {this.renderField(this.nls('centerMapOnClick'), (
            <input
              type="checkbox"
              checked={config.centerMapOnClick !== false}
              onChange={this.onCenterMapOnClickChange}
            />
          ))}
        </SettingSection>

        <div style={styles.sectionTitle}>{this.nls('googleSection')}</div>
        <SettingSection>
          {this.renderField(this.nls('apiKey'), (
            <input style={styles.fullWidth} value={config.googleEmbedApiKey || ''} onChange={this.onApiKeyChange} />
          ))}

          {hasApiKey && (
            <SettingRow>
              <div style={{ ...styles.field, ...styles.tosWarning }}>
                {this.nls('tosWarning')}
              </div>
            </SettingRow>
          )}
        </SettingSection>
      </div>
    )
  }
}
