{#-
    Shared key/parse helpers. Defined once so the GL side and the lookup side
    can never drift apart.
-#}

{%- macro mc_account_key(company_tla, account_code) -%}
    {#- ledger_accounts_l.account_key is company-scoped: the TLA is part of the
        key, which is why the GL needs a company bridge before it can join. -#}
    upper(trim({{ company_tla }})) || '-' || trim({{ account_code }})
{%- endmacro -%}


{%- macro mc_month_start(date_column) -%}
    date_trunc('month', {{ date_column }})::date
{%- endmacro -%}


{%- macro mc_parse_centre_code(label_column) -%}
    {#- Cost centre code is regex-parsed out of an Odoo display label, e.g.
        "[8051] Store UK" -> "8051". A rename in Odoo silently dumps postings
        into UNALLOCATED, so stg_gl_analytic_weights tests this. -#}
    nullif(regexp_substr({{ label_column }}, '\\[([0-9]+)\\]', 1, 1, 'e', 1), '')
{%- endmacro -%}


{%- macro mc_date_range_overlaps(valid_from_a, valid_to_a, valid_from_b, valid_to_b) -%}
    {#- Half-open ranges: valid_to is exclusive, '9999-12-31' for open-ended. -#}
    {{ valid_from_a }} < {{ valid_to_b }} and {{ valid_from_b }} < {{ valid_to_a }}
{%- endmacro -%}
