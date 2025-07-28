// --- FOLDING/TOGGLE FUNCTIONS ---
function foldTopSection() {
    document.getElementById('topSectionWrapper').classList.add('folded');
    document.getElementById('unfoldButtonContainer').style.display = 'block';
}

function toggleTopSection() {
    document.getElementById('topSectionWrapper').classList.toggle('folded');
}

function toggleSecondaryActivities() {
    const hiddenActivities = document.getElementById('hidden-activities');
    const toggleBtn = document.getElementById('toggle-activities-btn');
    if (!hiddenActivities || !toggleBtn) return;
    hiddenActivities.classList.toggle('hidden');
    const isHidden = hiddenActivities.classList.contains('hidden');
    toggleBtn.innerHTML = isHidden ? `Ver mais ${toggleBtn.dataset.remainingCount}...` : 'Ver menos';
}

// --- HELPER FUNCTIONS ---
function copyToClipboard(element) {
    const textToCopy = element.innerText?.toUpperCase();
    if (!textToCopy || textToCopy === 'N/A') return;
    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalHTML = element.innerHTML;
        element.innerHTML = '✅ Copiado!';
        setTimeout(() => { element.innerHTML = originalHTML; }, 1200);
    }).catch(err => console.error('Falha ao copiar:', err));
}

function limparCNPJ(cnpj) { return cnpj.replace(/[^0-9]/g, ''); }
function formatarCNPJ(cnpj) {
    const cnpjLimpo = limparCNPJ(cnpj);
    return cnpjLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}
function formatarTelefone(telefone) {
    if (!telefone) return 'N/A';
    const num = telefone.replace(/\D/g, '');
    if (num.length === 11) return `(${num.substring(0,2)}) ${num.substring(2,7)}-${num.substring(7)}`;
    if (num.length === 10) return `(${num.substring(0,2)}) ${num.substring(2,6)}-${num.substring(6)}`;
    return telefone;
}
function formatarData(data) {
    if (!data) return null;
    return new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
function formatarCapital(capital) {
    if (capital === null || capital === undefined) return 'N/A';
    return `R$ ${parseFloat(capital).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function validarCNPJ(cnpj) {
    const cnpjLimpo = limparCNPJ(cnpj);
    if (cnpjLimpo.length !== 14 || /^(\d)\1+$/.test(cnpjLimpo)) return false;
    let tamanho = cnpjLimpo.length - 2;
    let numeros = cnpjLimpo.substring(0, tamanho);
    let digitos = cnpjLimpo.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
        if (pos < 2) pos = 9;
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(0), 10)) return false;
    tamanho += 1;
    numeros = cnpjLimpo.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
        if (pos < 2) pos = 9;
    }
    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    return resultado === parseInt(digitos.charAt(1), 10);
}

document.getElementById('cnpjInput').addEventListener('input', function(e) {
    e.target.value = formatarCNPJ(e.target.value);
});
document.getElementById('cnpjInput').addEventListener('keypress', e => { if (e.key === 'Enter') consultarCNPJ(); });

// --- MAIN CONSULTATION LOGIC ---
async function consultarCNPJ() {
    const cnpjInput = document.getElementById('cnpjInput').value;
    const cnpjLimpo = limparCNPJ(cnpjInput);
    const resultsSection = document.getElementById('resultsSection');
    const loadingDiv = document.getElementById('loadingDiv');
    const resultsDiv = document.getElementById('resultsDiv');

    resultsDiv.innerHTML = '';
    if (!cnpjLimpo) { mostrarErro('Por favor, digite um CNPJ.'); return; }
    if (!validarCNPJ(cnpjLimpo)) { mostrarErro('CNPJ inválido! Verifique os números digitados.'); return; }

    resultsSection.classList.add('show');
    loadingDiv.style.display = 'block';

    try {
        // Fetch from CNPJ.A first, as it's the primary source
        const cnpjaData = await consultarCNPJA_API(cnpjLimpo);

        loadingDiv.style.display = 'none';

        if (!cnpjaData) {
            mostrarErro('Não foi possível obter os dados principais da empresa. A API pode estar indisponível.');
            return;
        }

        // Render the initial card with CNPJ.A data
        renderInitialCard(cnpjaData, resultsDiv);
        foldTopSection();

        // Now, fetch secondary data from ReceitaWS without blocking the UI
        consultarReceitaWS(cnpjLimpo).then(receitaWSData => {
            if (receitaWSData) {
                // Merge and update the UI with the new data
                updateCardWithReceitaWSData(cnpjaData, receitaWSData);
            } else {
                // Handle the case where ReceitaWS fails but CNPJA succeeded
                updateCardWithReceitaWSData(cnpjaData, null); // Will use defaults/placeholders
            }
        });

    } catch (error) {
        loadingDiv.style.display = 'none';
        mostrarErro('Erro na consulta principal: ' + error.message);
    }
}

// --- API FETCH FUNCTIONS ---
async function consultarCNPJA_API(cnpj) {
    try {
        const response = await fetch(`https://open.cnpja.com/office/${cnpj}`);
        if (response.ok) return await response.json();
        return null;
    } catch (error) {
        console.error('Erro na CNPJA API:', error);
        return null;
    }
}

async function consultarReceitaWS(cnpj) {
    try {
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`)}`);
        if (response.ok) {
            const result = JSON.parse((await response.json()).contents);
            if (result.status !== "ERROR") return result;
        }
        return null;
    } catch (error) {
        console.error('Erro na ReceitaWS API:', error);
        return null;
    }
}

// --- DYNAMIC RENDERING AND UPDATING ---

/**
 * Renders the initial company card with data from the first API (CNPJ.A).
 * Includes placeholders for data that will be loaded from the second API.
 */
function renderInitialCard(data, container) {
    const company = data.company || {};
    const address = data.address || {};
    const statusMap = { 1: { text: 'Ativa', class: 'status-active' }, 2: { text: 'Ativa', class: 'status-active' }, 3: { text: 'Suspensa', class: 'status-warning' }, 4: { text: 'Inapta', class: 'status-warning' }, 8: { text: 'Baixada', class: 'status-inactive' } };
    const statusInfo = statusMap[data.status?.id] || { text: 'Desconhecido', class: 'status-warning' };

    // Initial data available from CNPJ.A
    const ieHTML = gerarIEHTML(data.registrations, address.state);
    const sociosHTML = gerarSociosHTML(company.members);
    const contatoHTML = gerarContatoHTML(data.phones, data.emails);
    const secondGridHTML = (ieHTML || sociosHTML) ? `<div class="info-grid">${ieHTML}${sociosHTML}</div>` : '';

    container.innerHTML = `
        <div class="company-card">
            <div class="company-header">
                <div class="company-info-left">
                    <div class="company-name">${data.alias || company.name || 'N/A'}</div>
                    <div class="company-cnpj copyable" onclick="copyToClipboard(this)">${formatarCNPJ(data.taxId || '')}</div>
                </div>
                <div class="status-container">
                    <div id="tax-regime-placeholder"><div class="mini-spinner"></div></div>
                    <div class="status-badge ${statusInfo.class}">${statusInfo.text}</div>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-card">
                    <h3>📋 Informações Básicas</h3>
                    <p><strong>Razão Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${company.name || 'N/A'}</span></p>
                    <p><strong>Nome Fantasia:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.alias || 'N/A'}</span></p>
                    <p><strong>Data de Abertura:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarData(data.founded) || 'N/A'}</span></p>
                    <p><strong>Porte:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${company.size?.text || 'N/A'}</span></p>
                    <p><strong>Capital Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarCapital(company.equity)}</span></p>
                </div>
                <div class="info-card" id="economic-activity-card">
                    <h3>🏭 Atividade Econômica</h3>
                    <p><strong>Atividade Principal:</strong></p>
                    <p>${data.mainActivity?.text || 'N/A'}</p>
                    <p><strong>Código CNAE:</strong> ${data.mainActivity?.id || 'N/A'}</p>
                    <p><strong>Natureza Jurídica:</strong> ${data.legalNature?.text || 'N/A'}</p>
                    <div id="secondary-activities-placeholder"><div class="placeholder-loading"></div></div>
                </div>
                <div class="info-card">
                    <h3>📍 Endereço</h3>
                    <p><strong>Logradouro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.street || 'N/A'}</span></p>
                    <p><strong>Número:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.number || 'S/N'}</span></p>
                    ${address.details ? `<p><strong>Complemento:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.details}</span></p>` : ''}
                    <p><strong>Bairro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.district || 'N/A'}</span></p>
                    <p><strong>Cidade/UF:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.city || 'N/A'}</span> / <span class="copyable" onclick="copyToClipboard(this)">${address.state || 'N/A'}</span></p>
                    <p><strong>CEP:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.zip || 'N/A'}</span></p>
                </div>
                <div class="info-card">
                    <h3>📞 Contato</h3>
                    ${contatoHTML}
                </div>
            </div>
            ${secondGridHTML}
        </div>
    `;
}

/**
 * Updates the card with data from the second API (ReceitaWS) once it's available.
 */
function updateCardWithReceitaWSData(cnpjaData, receitaWSData) {
    const mergedData = {
        ...cnpjaData,
        simples: receitaWSData?.simples,
        simei: receitaWSData?.simei,
        atividades_secundarias_receitaws: receitaWSData?.atividades_secundarias,
    };

    // Update Tax Regime
    const taxPlaceholder = document.getElementById('tax-regime-placeholder');
    if (taxPlaceholder) {
        const taxRegimeInfo = getTaxRegimeInfo(mergedData);
        taxPlaceholder.innerHTML = `<div class="${taxRegimeInfo.class}">${taxRegimeInfo.text}</div>`;
    }

    // Update Secondary Activities
    const activitiesPlaceholder = document.getElementById('secondary-activities-placeholder');
    if (activitiesPlaceholder) {
        const secundarias = mergedData.atividades_secundarias_receitaws || cnpjaData.company?.sideActivities;
        activitiesPlaceholder.innerHTML = gerarAtividadesSecundariasHTML(secundarias);
    }
}

// --- HTML GENERATION HELPERS ---

function getTaxRegimeInfo(data) {
    if (data.simei?.optante === true) return { text: 'S I M E I', class: 'tax-regime-bar' };
    if (data.simples?.optante === true || data.simples?.opcao_pelo_simples === 'SIM') return { text: 'Simples', class: 'tax-regime-bar' };
    if (data.simples || data.simei) return { text: 'Trib: Normal', class: 'tax-regime-bar' };
    return { text: 'Trib: Outros', class: 'tax-regime-bar' };
}

function gerarAtividadesSecundariasHTML(activities) {
    if (!activities || activities.length === 0) {
        return '<p style="margin-top: 12px;"><strong>Atividades Secundárias:</strong><br>Nenhuma encontrada.</p>';
    }
    const total = activities.length;
    const limit = 2;
    const createActivityHTML = a => `<p class="activity-item">• ${a.text || 'N/A'} (${a.code || a.id || 'N/A'})</p>`;
    const visibleHtml = activities.slice(0, limit).map(createActivityHTML).join('');
    let hiddenHtml = '', toggleButtonHtml = '';
    if (total > limit) {
        const remaining = activities.slice(limit);
        hiddenHtml = `<div id="hidden-activities" class="hidden">${remaining.map(createActivityHTML).join('')}</div>`;
        toggleButtonHtml = `<p id="toggle-activities-btn" class="toggle-link" data-remaining-count="${remaining.length}" onclick="toggleSecondaryActivities()">Ver mais ${remaining.length}...</p>`;
    }
    return `
        <div class="secondary-activities-container">
            <p><strong>Atividades Secundárias (${total}):</strong></p>
            ${visibleHtml}${hiddenHtml}${toggleButtonHtml}
        </div>
    `;
}

function gerarContatoHTML(phones, emails) {
    let html = '';
    if (phones?.length > 0) {
        html += phones.slice(0, 2).map((p, i) => `<p><strong>Telefone ${i + 1}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarTelefone(p.number)}</span></p>`).join('');
    } else {
        html += '<p><strong>Telefone:</strong><br><span class="copyable" onclick="copyToClipboard(this)">N/A</span></p>';
    }
    if (emails?.length > 0) {
        html += emails.slice(0, 2).map((e, i) => `<p><strong>Email ${i + 1}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${e.address || 'N/A'}</span></p>`).join('');
    } else {
        html += '<p><strong>Email:</strong><br><span class="copyable" onclick="copyToClipboard(this)">N/A</span></p>';
    }
    return html;
}

function gerarIEHTML(registrations, mainState) {
    if (!registrations || registrations.length === 0) return '';
    let html = `<div class="info-card"><h3>🎯 Inscrições Estaduais</h3><div class="ie-list">`;
    registrations.forEach(reg => {
        const classes = ['ie-item'];
        if (!reg.enabled) classes.push('inactive');
        if (mainState && reg.state?.toUpperCase() === mainState.toUpperCase()) {
            classes.push(reg.enabled ? 'highlighted-active' : 'highlighted-inactive');
        }
        html += `
            <div class="${classes.join(' ')}">
                <p><strong>IE ${reg.state}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${reg.number || 'N/A'}</span></p>
                <p><strong>Status:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${reg.status?.text || 'Desconhecido'}</span></p>
            </div>`;
    });
    html += '</div></div>';
    return html;
}

function gerarSociosHTML(members) {
    if (!members || members.length === 0) return '';
    let html = `<div class="info-card"><h3>👥 Quadro Societário (${members.length})</h3>`;
    html += members.slice(0, 8).map(m => `<p>• ${m.person?.name || 'N/A'} <br><em>${m.role?.text || 'Sócio'}</em></p>`).join('');
    if (members.length > 8) html += `<p><em>... e mais ${members.length - 8} membros.</em></p>`;
    html += '</div>';
    return html;
}

function mostrarErro(mensagem) {
    const resultsSection = document.getElementById('resultsSection');
    const resultsDiv = document.getElementById('resultsDiv');
    resultsDiv.innerHTML = `<div class="error-message">❌ ${mensagem}</div>`;
    resultsSection.classList.add('show');
    foldTopSection();
}