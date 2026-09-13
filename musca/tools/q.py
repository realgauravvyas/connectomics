"""Query the MaleCNS connectome through the neuPrint cypher endpoint.

Handy for spot-checking a cell type or a connection before hard-coding it into a
behaviour. The endpoint answers without an auth token for read queries.

    python tools/q.py "MATCH (n:Neuron) WHERE n.type = 'LPLC2' RETURN count(n)"

Anything bigger than a few thousand rows is better served by the bulk tables in
`data-raw/` — single-neuron synapse queries against neuPrint time out.
"""
import json, urllib.request, sys

URL = "https://neuprint.janelia.org/api/custom/custom"
DATASET = "male-cns:v1.0"

def q(cypher, timeout=90):
    body = json.dumps({"cypher": cypher, "dataset": DATASET}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        raw = ""
        try:
            raw = e.read().decode()[:500]
        except Exception:
            pass
        return {"error": str(e), "raw": raw}

if __name__ == "__main__":
    cy = sys.argv[1]
    print(json.dumps(q(cy))[:3000])
