import { useEffect, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const exampleProperties = [
  { id: 'napa', name: 'Vinícola de exemplo · Napa Valley', region: 'Napa Valley', country: 'Estados Unidos', position: [38.2975, -122.2869] },
  { id: 'douro', name: 'Vinícola de exemplo · Douro', region: 'Vale do Douro', country: 'Portugal', position: [41.1579, -7.7986] },
  { id: 'tuscany', name: 'Vinícola de exemplo · Toscana', region: 'Toscana', country: 'Itália', position: [43.3188, 11.3308] },
  { id: 'mendoza', name: 'Vinícola de exemplo · Mendoza', region: 'Mendoza', country: 'Argentina', position: [-32.8895, -68.8458] },
  { id: 'marlborough', name: 'Vinícola de exemplo · Marlborough', region: 'Marlborough', country: 'Nova Zelândia', position: [-41.5134, 173.9612] },
]

const markerIcon = L.divIcon({
  className: 'vineyard-marker',
  html: '<span aria-hidden="true">📍</span>',
  iconSize: [34, 40],
  iconAnchor: [17, 38],
})

function FitProperties() {
  const map = useMap()

  useEffect(() => {
    const bounds = L.latLngBounds(exampleProperties.map((property) => property.position))
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 2 })
  }, [map])

  return null
}

export default function VineyardMap({ onOpenDetails }) {
  const [hoveredId, setHoveredId] = useState(null)
  const [pinnedId, setPinnedId] = useState(null)
  const visibleId = pinnedId || hoveredId
  const visibleProperty = exampleProperties.find((property) => property.id === visibleId)

  return (
    <section className="panel vineyard-map-panel" aria-labelledby="vineyard-map-title">
      <div className="panel-heading vineyard-map-heading">
        <div>
          <h2 id="vineyard-map-title">Vinícolas pelo mundo</h2>
          <p>Explore propriedades vitivinícolas nos principais continentes</p>
        </div>
        <span className="map-demo-badge">Localizações ilustrativas</span>
      </div>
      <div className="vineyard-map-layout">
        <div className="vineyard-map">
          <MapContainer
            center={[18, 8]}
            zoom={1}
            minZoom={0}
            maxZoom={12}
            scrollWheelZoom={false}
            worldCopyJump
            aria-label="Mapa global de propriedades vitivinícolas"
          >
            <FitProperties />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {exampleProperties.map((property) => (
              <Marker
                key={property.id}
                position={property.position}
                icon={markerIcon}
                title={`${property.name}, ${property.country}`}
                eventHandlers={{
                  mouseover: () => setHoveredId(property.id),
                  mouseout: () => setHoveredId(null),
                  click: () => setPinnedId(property.id),
                }}
              />
            ))}
          </MapContainer>
          {visibleProperty && (
            <article className={`map-property-preview ${pinnedId === visibleProperty.id ? 'pinned-preview' : 'hover-preview'}`} aria-live="polite">
              <button className="map-preview-close" onClick={() => setPinnedId(null)} aria-label="Fechar resumo">×</button>
              <span className="map-preview-eyebrow">PROPRIEDADE · DADOS DE EXEMPLO</span>
              <h3>{visibleProperty.name}</h3>
              <p>{visibleProperty.region} · {visibleProperty.country}</p>
              <span className="map-preview-pending">Aguardando integração com o backend</span>
              <button className="map-details-button" onClick={() => onOpenDetails(visibleProperty)}>Ver detalhes da vinícola <span aria-hidden="true">→</span></button>
            </article>
          )}
        </div>
        <aside className="map-property-list" aria-label="Regiões vitivinícolas de exemplo">
          <div className="map-list-heading"><strong>Regiões no mapa</strong><span>{exampleProperties.length}</span></div>
          {exampleProperties.map((property) => (
            <button
              className={`map-property-item ${pinnedId === property.id ? 'selected' : ''}`}
              key={property.id}
              onMouseEnter={() => setHoveredId(property.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(property.id)}
              onBlur={() => setHoveredId(null)}
              onClick={() => setPinnedId(property.id)}
            >
              <span className="map-list-pin" aria-hidden="true">📍</span>
              <span><strong>{property.region}</strong><small>{property.country}</small></span>
            </button>
          ))}
          <p className="map-list-note">Os marcadores atuais são ilustrativos. As coordenadas reais serão carregadas da API de propriedades.</p>
        </aside>
      </div>
    </section>
  )
}

export function VineyardDetails({ property, onClose }) {
  useEffect(() => {
    if (!property) return undefined
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [property, onClose])

  if (!property) return null

  return (
    <div className="vineyard-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="vineyard-modal" role="dialog" aria-modal="true" aria-labelledby="vineyard-modal-title">
        <button className="vineyard-modal-close" onClick={onClose} aria-label="Fechar detalhes">×</button>
        <span className="map-preview-eyebrow">DETALHES · LOCALIZAÇÃO ILUSTRATIVA</span>
        <h2 id="vineyard-modal-title">{property.name}</h2>
        <p className="vineyard-modal-region">{property.region} · {property.country}</p>
        <div className="vineyard-coordinates"><span>Latitude <strong>{property.position[0].toFixed(4)}°</strong></span><span>Longitude <strong>{property.position[1].toFixed(4)}°</strong></span></div>
        <p className="vineyard-modal-note">Esta propriedade e suas coordenadas são exemplos para demonstrar o mapa. Os dados reais serão exibidos quando a API de propriedades estiver disponível.</p>
        <button className="map-details-button" onClick={onClose}>Voltar ao mapa</button>
      </section>
    </div>
  )
}
