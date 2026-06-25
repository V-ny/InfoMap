"""Screenshot helper — carrega o IFrota web local e salva PNG após o mapa carregar.
Uso: python _shot.py [url] [out.png] [delay_ms]
"""
import sys
from PySide6.QtWidgets import QApplication
from PySide6.QtCore import QTimer, QUrl
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEnginePage

url   = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000/index.html"
out   = sys.argv[2] if len(sys.argv) > 2 else "_shot.png"
delay = int(sys.argv[3]) if len(sys.argv) > 3 else 7000
js    = sys.argv[4] if len(sys.argv) > 4 else ""   # JS executado ~1s antes do grab

app = QApplication([])

logs = []
class Page(QWebEnginePage):
    def javaScriptConsoleMessage(self, level, msg, line, src):
        logs.append(f"[JS:{level}] {msg}")

view = QWebEngineView()
view.setPage(Page(view))
view.resize(420, 820)
view.load(QUrl(url))
view.show()

def grab():
    view.grab().save(out)
    print(f"SHOT salvo: {out}")
    for l in logs[-40:]:
        print(l)
    app.quit()

def run_js():
    if js:
        view.page().runJavaScript(js)

if js:
    # Roda o JS cedo (tempo fixo) pra dar margem a animações antes do grab.
    QTimer.singleShot(min(4500, delay // 2), run_js)
QTimer.singleShot(delay, grab)
app.exec()
