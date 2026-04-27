import folium

# 1. Definindo os Limites (Bounding Box) do IFRJ Pinheiral
# É necessário definir o canto Sudoeste (SW) e o canto Nordeste (NE)
# Dica: No Google Maps, clique com botão direito em dois pontos opostos do campus para pegar isso.

# Canto Inferior Esquerdo (Sudoeste)
sw_lat, sw_lon = -22.522388, -43.995805
# Canto Superior Direito (Nordeste)
ne_lat, ne_lon = -22.517994, -43.989114

# Centro calculado (apenas para inicialização)
campus_center = [(sw_lat + ne_lat)/2, (sw_lon + ne_lon)/2]

# 2. Configuração do Mapa com Travas
mapa = folium.Map(
    location=campus_center,
    zoom_start=17,
    # AQUI ESTÁ O SEGREDO DA LIMITAÇÃO:
    min_lat=sw_lat, 
    max_lat=ne_lat,
    min_lon=sw_lon, 
    max_lon=ne_lon,
    max_bounds=True,  # Impede o usuário de arrastar para fora dos limites acima
    min_zoom=16,      # Impede o usuário de tirar muito o zoom
    max_zoom=19       # Limite máximo de aproximação
)

# 3. Adicionando um Retângulo Visual (Opcional - Bom para Debug)
# Isso desenha uma linha vermelha mostrando onde está o limite da sua área
folium.Rectangle(
    bounds=[[sw_lat, sw_lon], [ne_lat, ne_lon]],
    color="#ff0000",
    fill=False,
    weight=2,
    dash_array='5, 5', # Linha tracejada
    tooltip="Área Limite do Sistema"
).add_to(mapa)

# 4. Adicionando Locais (Exemplos anteriores)
locais = {
    "diretoria": [-22.521774, -43.990663],
    "portaria1": [-22.518476, -43.995129],
    "portaria2": [-22.520139, -43.994636],
    "biblioteca": [-22.520877, -43.990945],
    "predio": [-22.520178, -43.994086],
    "auditorio": [-22.520218, -43.990749],
    "cantina": [-22.520270, -43.990411],
    "quadra": [-22.520471, -43.990526],
    "plantacao": [-22.519237, -43.994515],
    "suinocultura": [-22.520040, -43.993464],
    "equinos": [-22.520149, -43.992557],
    "estufa": [-22.520243, -43.991634],
    "laboratorioartes": [-22.522104, -43.990095],

}

folium.Marker(locais["portaria1"], popup="Portaria 1", icon=folium.Icon(color="green")).add_to(mapa)
folium.Marker(locais["portaria2"], popup="Portaria 2", icon=folium.Icon(color="green")).add_to(mapa)
folium.Marker(locais["biblioteca"], popup="Biblioteca", icon=folium.Icon(color="blue")).add_to(mapa)
folium.Marker(locais["diretoria"], popup="Diretoria", icon=folium.Icon(color="red")).add_to(mapa)
folium.Marker(locais["predio"], popup="Prédio", icon=folium.Icon(color="orange")).add_to(mapa)
folium.Marker(locais["auditorio"], popup="Auditório", icon=folium.Icon(color="purple")).add_to(mapa)
folium.Marker(locais["cantina"], popup="Cantina", icon=folium.Icon(color="brown")).add_to(mapa)
folium.Marker(locais["quadra"], popup="Quadra", icon=folium.Icon(color="darkgreen")).add_to(mapa)
folium.Marker(locais["plantacao"], popup="Plantação", icon=folium.Icon(color="darkblue")).add_to(mapa)
folium.Marker(locais["suinocultura"], popup="Suinocultura", icon=folium.Icon(color="darkred")).add_to(mapa)
folium.Marker(locais["equinos"], popup="Equinos", icon=folium.Icon(color="darkpurple")).add_to(mapa)
folium.Marker(locais["estufa"], popup="Estufa", icon=folium.Icon(color="darkorange")).add_to(mapa)
folium.Marker(locais["laboratorioartes"], popup="Laboratório de Artes", icon=folium.Icon(color="darkpink")).add_to(mapa)

# 5. Salvar
mapa.save("mapa_ifrj_limitado.html")
print("Mapa gerado com restrição de área.")