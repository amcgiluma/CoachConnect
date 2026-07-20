from .schemas import Category, CoachSummary, ServiceMode


CATEGORIES = [
    Category(id="fitness", name="Fitness y fuerza", name_en="Fitness & strength", subcategories=["Musculación", "Pérdida de peso", "Funcional", "Calistenia"]),
    Category(id="martial", name="Artes marciales", name_en="Martial arts", subcategories=["Muay Thai", "Boxeo", "Karate", "Kung fu", "Judo", "MMA"]),
    Category(id="running", name="Running y resistencia", name_en="Running & endurance", subcategories=["Running", "Trail", "Ciclismo", "Natación"]),
    Category(id="mobility", name="Movilidad y cuerpo", name_en="Mobility & body", subcategories=["Yoga", "Pilates", "Flexibilidad", "Movilidad"]),
    Category(id="sport", name="Preparación deportiva", name_en="Sports performance", subcategories=["Fútbol", "Pádel", "Tenis", "Rendimiento"]),
    Category(id="dance", name="Danza y movimiento", name_en="Dance & movement", subcategories=["Danza urbana", "Ballet", "Contemporáneo"]),
    Category(id="outdoor", name="Entrenamiento exterior", name_en="Outdoor training", subcategories=["Parque", "Outdoor", "Entreno en grupo"]),
    Category(id="wellbeing", name="Bienestar aplicado", name_en="Applied wellbeing", subcategories=["Nutrición", "Hábitos", "Recuperación"]),
]

COACHES = [
    CoachSummary(id="ines-martin", name="Inés Martín", specialty="Fuerza y movilidad", category="fitness", mode=ServiceMode.hybrid, city="Madrid", rating=4.9, reviews=42, price_from=32, next_slot="Hoy · 18:30", responds_now=True, verified=True),
    CoachSummary(id="marcos-sanz", name="Marcos Sanz", specialty="Muay Thai", category="martial", mode=ServiceMode.in_person, city="Madrid", rating=5.0, reviews=28, price_from=28, next_slot="Hoy · 20:00", responds_now=True, verified=True),
    CoachSummary(id="laura-cano", name="Laura Cano", specialty="Running y resistencia", category="running", mode=ServiceMode.online, city="Barcelona", rating=4.8, reviews=63, price_from=25, next_slot="Mañana · 07:30", responds_now=False, verified=True),
    CoachSummary(id="diego-ortiz", name="Diego Ortiz", specialty="Movilidad y yoga", category="mobility", mode=ServiceMode.hybrid, city="Valencia", rating=4.7, reviews=19, price_from=24, next_slot="Jueves · 09:00", responds_now=False, verified=True),
]
