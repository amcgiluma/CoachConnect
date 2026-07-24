import { CircleMarker, MapContainer, Popup, TileLayer } from 'react-leaflet'
import type { Coach } from '../data'
import 'leaflet/dist/leaflet.css'

const cityCoordinates: Record<string, [number, number]> = {
  Madrid: [40.4168, -3.7038],
  Barcelona: [41.3874, 2.1686],
  Valencia: [39.4699, -0.3763],
  Online: [40.4168, -3.7038],
}

export function CoachMap({ coaches, onCoach }: { coaches: Coach[]; onCoach: (coach: Coach) => void }) {
  const center = cityCoordinates[coaches[0]?.city] || cityCoordinates.Madrid
  return <aside className="map-panel real-map" aria-label="Mapa aproximado de entrenadores">
    <MapContainer center={center} zoom={6} scrollWheelZoom className="leaflet-map">
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {coaches.map((coach, index) => {
        const base = cityCoordinates[coach.city] || center
        const position: [number, number] = [base[0] + index * .012, base[1] - index * .01]
        return <CircleMarker key={coach.id} center={position} radius={13} pathOptions={{ color: '#11120f', fillColor: '#c8ff20', fillOpacity: 1, weight: 3 }}>
          <Popup><button className="map-popup" onClick={() => onCoach(coach)}><strong>{coach.name}</strong><span>{coach.specialty} · {coach.price} €</span></button></Popup>
        </CircleMarker>
      })}
    </MapContainer>
    <p className="privacy-map-note">Ubicación aproximada. La dirección exacta solo se comparte tras reservar.</p>
  </aside>
}
